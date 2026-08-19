// --- 1. Geração de QR Code ---
document.getElementById('btnGenerateQR').addEventListener('click', () => {
    const productName = document.getElementById('productName').value;
    const container = document.getElementById('qrcode-container');
    container.innerHTML = ''; // Limpa o anterior

    if (productName.trim() === '') {
        alert('Digite o nome ou código da peça.');
        return;
    }

    new QRCode(container, {
        text: productName,
        width: 128,
        height: 128
    });
});

// --- 2. Lógica de Abas ---
function openTab(tabName) {
    document.querySelectorAll('.tab-content').forEach(tab => tab.classList.remove('active'));
    document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
    
    document.getElementById(`tab-${tabName}`).classList.add('active');
    event.currentTarget.classList.add('active');
}

// --- 3. Visão Computacional e Lógica de Estoque ---
const html5QrCode = new Html5Qrcode("reader");
let itemsInView = {};
let movementHistory = [];
let timeToExitMs = 60 * 60 * 1000;
const REENTRY_GAP_MS = 1500;
const stockList = document.getElementById('stockList');
const presentCount = document.getElementById('presentCount');
const productSearch = document.getElementById('productSearch');
let activePlacementProduct = null;
const inventoryPositions = {};
const qrOverlay = document.getElementById('qrOverlay');
const qrOverlayLabel = document.getElementById('qrOverlayLabel');
const qrLocation = document.getElementById('qrLocation');

// Atualiza o tempo de tolerância quando o usuário clica em Aplicar
document.getElementById('btnApplyTimeout').addEventListener('click', () => {
    const minutes = parseInt(document.getElementById('timeoutInput').value, 10);

    if (Number.isInteger(minutes) && minutes > 0) {
        timeToExitMs = minutes * 60 * 1000;
        alert(`Tempo de tolerância atualizado para ${minutes} minuto(s).`);
    } else {
        alert('Por favor, insira um valor válido maior que zero.');
    }
});

function renderStock() {
    const grouped = Object.entries(itemsInView).reduce((acc, [product, state]) => {
        if (state.status === 'inside') {
            acc[product] = (acc[product] || 0) + 1;
        }
        return acc;
    }, {});

    const searchTerm = productSearch.value.trim().toLowerCase();
    const entries = Object.entries(grouped).filter(([product]) => product.toLowerCase().includes(searchTerm));
    presentCount.textContent = `${entries.length} presente${entries.length === 1 ? '' : 's'}`;

    stockList.innerHTML = '';

    if (entries.length === 0) {
        stockList.innerHTML = '<li class="stock-item"><strong>Nenhum item encontrado</strong></li>';
        return;
    }

    entries.forEach(([product, quantity]) => {
        const item = document.createElement('li');
        item.className = 'stock-item';
        if (product.toLowerCase() === searchTerm) {
            item.classList.add('highlighted');
        }

        const position = inventoryPositions[product] && inventoryPositions[product][document.getElementById('cameraSelect').value];
        const locationText = position
            ? `${document.getElementById('cameraSelect').value} • L${position.row + 1} / C${position.col + 1}`
            : 'Sem localização definida';

        item.innerHTML = `<div><strong>${product}</strong><br><small>${locationText}</small></div><span>${quantity} item${quantity === 1 ? '' : 's'}</span>`;
        stockList.appendChild(item);
    });
}

function getGridConfig() {
    const width = parseInt(document.getElementById('cameraWidth').value, 10) || 1920;
    const height = parseInt(document.getElementById('cameraHeight').value, 10) || 1080;
    const columns = Math.max(8, Math.min(24, Math.round(width / 120)));
    const rows = Math.max(6, Math.min(18, Math.round(height / 120)));
    return { width, height, columns, rows };
}

function updateActivePlacementLabel() {
    const label = document.getElementById('activePlacementLabel');
    label.textContent = activePlacementProduct
        ? `Produto ativo: ${activePlacementProduct}`
        : 'Produto ativo: Nenhum';
}

function getResultPoints(decodedResult) {
    return decodedResult?.result?.resultPoints || decodedResult?.resultPoints || [];
}

function getQrLocation(decodedResult) {
    const points = getResultPoints(decodedResult)
        .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y));

    if (points.length < 2) return null;

    const xValues = points.map((point) => point.x);
    const yValues = points.map((point) => point.y);
    const left = Math.min(...xValues);
    const top = Math.min(...yValues);
    const right = Math.max(...xValues);
    const bottom = Math.max(...yValues);
    const width = right - left;
    const height = bottom - top;
    const resolution = html5QrCode.getRunningTrackSettings?.() || {};
    const videoWidth = resolution.width || parseInt(document.getElementById('cameraWidth').value, 10) || 1920;
    const videoHeight = resolution.height || parseInt(document.getElementById('cameraHeight').value, 10) || 1080;
    const { columns, rows } = getGridConfig();
    const centerX = left + width / 2;
    const centerY = top + height / 2;

    return {
        x: Math.round(centerX),
        y: Math.round(centerY),
        left,
        top,
        width,
        height,
        videoWidth,
        videoHeight,
        row: Math.min(rows - 1, Math.max(0, Math.floor((centerY / videoHeight) * rows))),
        col: Math.min(columns - 1, Math.max(0, Math.floor((centerX / videoWidth) * columns)))
    };
}

function showQrLocation(location, product) {
    if (!location) {
        qrLocation.textContent = `QR detectado: ${product} (coordenadas indisponíveis)`;
        return;
    }

    qrLocation.textContent = `QR: ${product} • X: ${location.x}px, Y: ${location.y}px • ${location.videoWidth}x${location.videoHeight} • L${location.row + 1} / C${location.col + 1}`;
    const video = document.querySelector('#reader video');
    if (!video) return;

    qrOverlay.hidden = false;
    qrOverlay.style.left = `${(location.left / location.videoWidth) * 100}%`;
    qrOverlay.style.top = `${(location.top / location.videoHeight) * 100}%`;
    qrOverlay.style.width = `${(location.width / location.videoWidth) * 100}%`;
    qrOverlay.style.height = `${(location.height / location.videoHeight) * 100}%`;
    qrOverlayLabel.textContent = `${product} (${location.x}, ${location.y})`;
}

function autoPlaceProduct(product, location) {
    const camera = document.getElementById('cameraSelect').value;

    if (!inventoryPositions[product]) {
        inventoryPositions[product] = {};
    }

    if (location) {
        inventoryPositions[product][camera] = {
            row: location.row,
            col: location.col,
            x: location.x,
            y: location.y,
            width: location.videoWidth,
            height: location.videoHeight
        };
    }

    renderVirtualGrid();
    renderMobileSummary();
}

function renderVirtualGrid() {
    const grid = document.getElementById('virtualGrid');
    const { columns, rows } = getGridConfig();
    const camera = document.getElementById('cameraSelect').value;

    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(60px, 1fr))`;
    grid.innerHTML = '';

    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const cell = document.createElement('button');
            cell.className = 'grid-cell';
            const foundEntry = Object.entries(inventoryPositions).find(([, positions]) => positions[camera] && positions[camera].row === row && positions[camera].col === col);

            if (foundEntry) {
                cell.classList.add('has-product');
                cell.textContent = foundEntry[0];
            } else {
                cell.textContent = `${row + 1}-${col + 1}`;
            }

            cell.addEventListener('click', () => {
                if (!activePlacementProduct) {
                    alert('Escaneie um QR code primeiro para posicionar o produto.');
                    return;
                }

                if (!inventoryPositions[activePlacementProduct]) {
                    inventoryPositions[activePlacementProduct] = {};
                }

                inventoryPositions[activePlacementProduct][camera] = { row, col };
                renderVirtualGrid();
                renderMobileSummary();
            });

            grid.appendChild(cell);
        }
    }
}

function renderMobileSummary() {
    const container = document.getElementById('mobileSummaryList');
    const camera = document.getElementById('cameraSelect').value;
    const entries = Object.entries(inventoryPositions).filter(([, positions]) => positions[camera]);

    container.innerHTML = '';

    if (entries.length === 0) {
        container.innerHTML = '<div class="mobile-summary-item"><strong>Nenhum produto posicionado ainda</strong></div>';
        return;
    }

    entries.forEach(([product, positions]) => {
        const position = positions[camera];
        const item = document.createElement('div');
        item.className = 'mobile-summary-item';
        item.innerHTML = `<div><strong>${product}</strong><br><small>${camera} • L${position.row + 1} / C${position.col + 1}</small></div><span>OK</span>`;
        container.appendChild(item);
    });
}

function exportInventoryMap() {
    const { width, height, columns, rows } = getGridConfig();
    const camera = document.getElementById('cameraSelect').value;
    const lines = [];

    lines.push(['Mapa Virtual do Estoque', '']);
    lines.push(['Câmera', camera]);
    lines.push(['Resolução', `${width}x${height}`]);
    lines.push([]);
    lines.push(['', ...Array.from({ length: columns }, (_, index) => `Coluna ${index + 1}`)]);

    for (let row = 0; row < rows; row += 1) {
        const values = [`Linha ${row + 1}`];
        for (let col = 0; col < columns; col += 1) {
            const found = Object.entries(inventoryPositions).find(([, positions]) => positions[camera] && positions[camera].row === row && positions[camera].col === col);
            values.push(found ? found[0] : '');
        }
        lines.push(values);
    }

    lines.push([]);
    lines.push(['Total por Produto', 'Quantidade']);

    const totals = Object.entries(inventoryPositions).reduce((acc, [product, positions]) => {
        if (positions[camera]) {
            acc[product] = (acc[product] || 0) + 1;
        }
        return acc;
    }, {});

    Object.entries(totals).forEach(([product, quantity]) => {
        lines.push([product, quantity]);
    });

    const csvContent = lines.map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', 'mapa_estoque.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function registerMovement(product, type) {
    const date = new Date();
    const timeString = date.toLocaleString('pt-BR');

    movementHistory.push({ data: timeString, produto: product, tipo: type });

    const tr = document.createElement('tr');
    tr.innerHTML = `
        <td>${timeString}</td>
        <td>${product}</td>
        <td><span class="${type === 'entrada' ? 'badge-entrada' : 'badge-saida'}">${type.toUpperCase()}</span></td>
    `;

    if (type === 'entrada') {
        document.getElementById('tableEntradaBody').prepend(tr);
    } else {
        document.getElementById('tableSaidaBody').prepend(tr);
    }
}

const qrCodeSuccessCallback = (decodedText, decodedResult) => {
    const now = Date.now();
    const productState = itemsInView[decodedText];
    const location = getQrLocation(decodedResult);
    activePlacementProduct = decodedText;
    updateActivePlacementLabel();
    showQrLocation(location, decodedText);

    if (!productState) {
        registerMovement(decodedText, 'entrada');
        itemsInView[decodedText] = { lastSeen: now, status: 'inside', lastEntryAt: now, lastExitAt: 0 };
        autoPlaceProduct(decodedText, location);
        renderStock();
        return;
    }

    if (productState.status === 'outside' && now - productState.lastExitAt >= REENTRY_GAP_MS) {
        registerMovement(decodedText, 'entrada');
        productState.status = 'inside';
        productState.lastEntryAt = now;
    }

    productState.lastSeen = now;
    productState.status = 'inside';
    autoPlaceProduct(decodedText, location);
    renderStock();
};

setInterval(() => {
    const now = Date.now();
    for (let product in itemsInView) {
        const productState = itemsInView[product];
        if (productState.status === 'inside' && now - productState.lastSeen > timeToExitMs) {
            registerMovement(product, 'saida');
            productState.status = 'outside';
            productState.lastExitAt = now;
        }
    }
    renderStock();
}, 1000);

// Controles da Câmera
async function selectBestCamera() {
    const devices = await Html5Qrcode.getCameras();
    const rearCamera = devices.find((device) => /back|rear|traseira|environment/i.test(device.label));
    return rearCamera?.id;
}

async function getBestResolution(cameraId) {
    const temporaryStream = await navigator.mediaDevices.getUserMedia({
        video: cameraId ? { deviceId: { exact: cameraId } } : { facingMode: { ideal: 'environment' } }
    });
    const track = temporaryStream.getVideoTracks()[0];
    const settings = track.getSettings();
    const capabilities = track.getCapabilities?.() || {};
    temporaryStream.getTracks().forEach((streamTrack) => streamTrack.stop());

    return {
        width: capabilities.width?.max || settings.width || 1920,
        height: capabilities.height?.max || settings.height || 1080
    };
}

document.getElementById('btnStartCamera').addEventListener('click', async () => {
    document.getElementById('cameraStatus').innerText = 'Escolhendo câmera e resolução...';
    const scanConfig = {
        fps: 20,
        disableFlip: false,
        videoConstraints: { width: { ideal: 1920 }, height: { ideal: 1080 } },
        ...(window.Html5QrcodeSupportedFormats ? { formatsToSupport: [window.Html5QrcodeSupportedFormats.QR_CODE] } : {})
    };

    try {
        const cameraId = await selectBestCamera();
        const bestResolution = await getBestResolution(cameraId);
        document.getElementById('cameraWidth').value = bestResolution.width;
        document.getElementById('cameraHeight').value = bestResolution.height;
        renderVirtualGrid();
        renderMobileSummary();
        scanConfig.videoConstraints = {
            deviceId: cameraId ? { exact: cameraId } : undefined,
            width: { ideal: bestResolution.width },
            height: { ideal: bestResolution.height }
        };
        await html5QrCode.start(cameraId || { facingMode: 'environment' }, scanConfig, qrCodeSuccessCallback);
        document.getElementById('cameraStatus').innerText = `Monitorando • resolução ${bestResolution.width}x${bestResolution.height}`;
    } catch (err) {
        document.getElementById('cameraStatus').innerText = 'Não foi possível iniciar a câmera';
        console.error(err);
    }
});

document.getElementById('btnStopCamera').addEventListener('click', () => {
    html5QrCode.stop().then(() => {
        document.getElementById('cameraStatus').innerText = 'Câmera Desligada';
        qrOverlay.hidden = true;
        qrLocation.textContent = 'Localização do QR: aguardando leitura';
        itemsInView = {};
        renderStock();
    }).catch(err => console.error(err));
});

document.getElementById('btnExportMap').addEventListener('click', exportInventoryMap);
document.getElementById('cameraWidth').addEventListener('input', renderVirtualGrid);
document.getElementById('cameraHeight').addEventListener('input', renderVirtualGrid);
document.getElementById('cameraSelect').addEventListener('change', () => {
    renderVirtualGrid();
    renderMobileSummary();
});
document.getElementById('btnSearchProduct').addEventListener('click', () => {
    renderStock();
    renderMobileSummary();
});
productSearch.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
        renderStock();
        renderMobileSummary();
    }
});
document.getElementById('btnToggleMobile').addEventListener('click', () => {
    document.body.classList.toggle('mobile-view-active');
    const button = document.getElementById('btnToggleMobile');
    button.textContent = document.body.classList.contains('mobile-view-active')
        ? '🖥️ Voltar à visão desktop'
        : '📱 Alternar visualização';
});

renderVirtualGrid();
renderMobileSummary();
renderStock();

// --- 4. Exportação para CSV ---
document.getElementById('btnExport').addEventListener('click', () => {
    if (movementHistory.length === 0) {
        alert("Não há dados para exportar.");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,Data/Hora,Produto,Tipo\n";
    movementHistory.forEach(row => {
        csvContent += `${row.data},${row.produto},${row.tipo}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", "relatorio_estoque.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
});