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
const gridMappingStatus = document.getElementById('gridMappingStatus');
const mappingToggle = document.getElementById('mappingToggle');
const mappingCanvas = document.getElementById('mappingCanvas');
const mappingContext = mappingCanvas.getContext('2d');
const mappingTrail = [];
const scanCanvas = document.createElement('canvas');
const scanContext = scanCanvas.getContext('2d', { willReadFrequently: true });
let jsQrAnimationFrame = null;
let lastJsQrReadAt = 0;

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
    const location = decodedResult?.location;
    if (location) {
        return [
            location.topLeftCorner,
            location.topRightCorner,
            location.bottomRightCorner,
            location.bottomLeftCorner
        ].filter(Boolean);
    }

    const points = decodedResult?.result?.resultPoints
        || decodedResult?.resultPoints
        || decodedResult?.result?.cornerPoints
        || decodedResult?.cornerPoints
        || decodedResult?.points;

    return Array.isArray(points) ? points : [];
}

function getPointCoordinate(point, coordinate) {
    if (Number.isFinite(Number(point?.[coordinate]))) {
        return Number(point[coordinate]);
    }

    const getter = point?.[`get${coordinate.toUpperCase()}`];
    return typeof getter === 'function' ? Number(getter.call(point)) : NaN;
}

function getQrLocation(decodedResult) {
    const points = getResultPoints(decodedResult)
        .map((point) => ({
            x: getPointCoordinate(point, 'x'),
            y: getPointCoordinate(point, 'y')
        }))
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
    const video = document.querySelector('#reader video');
    const videoWidth = video?.videoWidth || resolution.width || parseInt(document.getElementById('cameraWidth').value, 10) || 1920;
    const videoHeight = video?.videoHeight || resolution.height || parseInt(document.getElementById('cameraHeight').value, 10) || 1080;
    const { columns, rows } = getGridConfig();
    const centerX = points.reduce((sum, point) => sum + point.x, 0) / points.length;
    const centerY = points.reduce((sum, point) => sum + point.y, 0) / points.length;

    return {
        x: centerX,
        y: centerY,
        left,
        top,
        width,
        height,
        corners: points,
        videoWidth,
        videoHeight,
        row: Math.min(rows - 1, Math.max(0, Math.floor((centerY / videoHeight) * rows))),
        col: Math.min(columns - 1, Math.max(0, Math.floor((centerX / videoWidth) * columns)))
    };
}

function drawMapping(location) {
    const video = document.querySelector('#reader video');
    if (!video || !location || !mappingToggle.checked) return;

    const width = location.videoWidth;
    const height = location.videoHeight;
    mappingCanvas.hidden = false;
    mappingCanvas.width = width;
    mappingCanvas.height = height;
    mappingTrail.push({ x: location.x, y: location.y });
    if (mappingTrail.length > 20) mappingTrail.shift();

    mappingContext.clearRect(0, 0, width, height);
    mappingContext.strokeStyle = 'rgba(125, 211, 252, 0.3)';
    mappingContext.lineWidth = 1;
    for (let x = 0; x <= width; x += width / 8) {
        mappingContext.beginPath();
        mappingContext.moveTo(x, 0);
        mappingContext.lineTo(x, height);
        mappingContext.stroke();
    }
    for (let y = 0; y <= height; y += height / 6) {
        mappingContext.beginPath();
        mappingContext.moveTo(0, y);
        mappingContext.lineTo(width, y);
        mappingContext.stroke();
    }

    mappingContext.strokeStyle = 'rgba(248, 250, 252, 0.85)';
    mappingContext.lineWidth = 2;
    mappingContext.beginPath();
    mappingContext.moveTo(location.x, 0);
    mappingContext.lineTo(location.x, height);
    mappingContext.moveTo(0, location.y);
    mappingContext.lineTo(width, location.y);
    mappingContext.stroke();

    if (location.corners?.length === 4) {
        mappingContext.strokeStyle = '#22c55e';
        mappingContext.fillStyle = 'rgba(34, 197, 94, 0.18)';
        mappingContext.lineWidth = 5;
        mappingContext.beginPath();
        mappingContext.moveTo(location.corners[0].x, location.corners[0].y);
        location.corners.slice(1).forEach((corner) => mappingContext.lineTo(corner.x, corner.y));
        mappingContext.closePath();
        mappingContext.fill();
        mappingContext.stroke();
    }

    mappingTrail.forEach((point, index) => {
        mappingContext.fillStyle = `rgba(250, 204, 21, ${0.15 + ((index + 1) / mappingTrail.length) * 0.7})`;
        mappingContext.beginPath();
        mappingContext.arc(point.x, point.y, index === mappingTrail.length - 1 ? 9 : 4, 0, Math.PI * 2);
        mappingContext.fill();
    });

    mappingContext.fillStyle = '#facc15';
    mappingContext.font = 'bold 22px Consolas, monospace';
    mappingContext.fillText(`X: ${Math.round(location.x)}px  Y: ${Math.round(location.y)}px`, 16, 30);
}

function updateMappingVisibility() {
    const visible = mappingToggle.checked;
    mappingCanvas.hidden = !visible;
    qrOverlay.hidden = !visible || qrOverlay.dataset.detected !== 'true';
    if (visible && mappingTrail.length > 0) {
        const lastPoint = mappingTrail[mappingTrail.length - 1];
        drawMapping({
            x: lastPoint.x,
            y: lastPoint.y,
            videoWidth: mappingCanvas.width,
            videoHeight: mappingCanvas.height
        });
    }
}

function showQrLocation(location, product) {
    if (!location) {
        qrLocation.textContent = `QR detectado: ${product} (coordenadas indisponíveis)`;
        return;
    }

    qrLocation.textContent = `QR: ${product} • X: ${Math.round(location.x)}px, Y: ${Math.round(location.y)}px • ${location.videoWidth}x${location.videoHeight} • L${location.row + 1} / C${location.col + 1}`;
    const video = document.querySelector('#reader video');
    if (!video) return;

    qrOverlay.hidden = false;
    qrOverlay.dataset.detected = 'true';
    qrOverlay.style.left = `${(location.left / location.videoWidth) * 100}%`;
    qrOverlay.style.top = `${(location.top / location.videoHeight) * 100}%`;
    qrOverlay.style.width = `${(location.width / location.videoWidth) * 100}%`;
    qrOverlay.style.height = `${(location.height / location.videoHeight) * 100}%`;
    qrOverlayLabel.textContent = `${product} (${Math.round(location.x)}, ${Math.round(location.y)})`;
    drawMapping(location);
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
        gridMappingStatus.textContent = `Mapa atualizado: ${product} em X ${location.x.toFixed(2)}px, Y ${location.y.toFixed(2)}px • Linha ${location.row + 1}, Coluna ${location.col + 1}`;
    }

    renderVirtualGrid();
    renderMobileSummary();
}

function scanVideoWithJsQr() {
    const video = document.querySelector('#reader video');
    if (!window.jsQR) {
        document.getElementById('cameraStatus').innerText = 'Erro: jsQR não foi carregado';
        return;
    }
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
        jsQrAnimationFrame = requestAnimationFrame(scanVideoWithJsQr);
        return;
    }

    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!width || !height) {
        jsQrAnimationFrame = requestAnimationFrame(scanVideoWithJsQr);
        return;
    }

    scanCanvas.width = width;
    scanCanvas.height = height;
    scanContext.drawImage(video, 0, 0, width, height);
    const imageData = scanContext.getImageData(0, 0, width, height);
    const code = window.jsQR(imageData.data, width, height, { inversionAttempts: 'attemptBoth' });
    const now = performance.now();

    if (code && now - lastJsQrReadAt >= 100) {
        lastJsQrReadAt = now;
        qrCodeSuccessCallback(code.data, { location: code.location });
    }

    jsQrAnimationFrame = requestAnimationFrame(scanVideoWithJsQr);
}

function stopJsQrScan() {
    if (jsQrAnimationFrame !== null) {
        cancelAnimationFrame(jsQrAnimationFrame);
        jsQrAnimationFrame = null;
    }
}

function renderVirtualGrid() {
    const grid = document.getElementById('virtualGrid');
    const { columns, rows } = getGridConfig();
    const camera = document.getElementById('cameraSelect').value;

    grid.style.gridTemplateColumns = `repeat(${columns}, minmax(60px, 1fr))`;
    grid.style.aspectRatio = `${getGridConfig().width} / ${getGridConfig().height}`;
    grid.innerHTML = '';

    for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < columns; col += 1) {
            const cell = document.createElement('button');
            cell.className = 'grid-cell';
            const foundEntry = Object.entries(inventoryPositions).find(([, positions]) => positions[camera] && positions[camera].row === row && positions[camera].col === col);

            if (foundEntry) {
                cell.classList.add('has-product');
                const [product, positions] = foundEntry;
                const position = positions[camera];
                if (product === activePlacementProduct) {
                    cell.classList.add('active-product');
                }
                cell.innerHTML = `<strong>${product}</strong><small>X ${position.x ?? '-'} / Y ${position.y ?? '-'}</small>`;
                cell.title = `${product} • X: ${position.x ?? '-'}px, Y: ${position.y ?? '-'}px`;
                if (product === activePlacementProduct) {
                    cell.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
                }
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
        await html5QrCode.start(cameraId || { facingMode: 'environment' }, scanConfig, () => {});
        const actualResolution = html5QrCode.getRunningTrackSettings?.() || {};
        const actualWidth = actualResolution.width || bestResolution.width;
        const actualHeight = actualResolution.height || bestResolution.height;
        document.getElementById('cameraWidth').value = actualWidth;
        document.getElementById('cameraHeight').value = actualHeight;
        renderVirtualGrid();
        scanVideoWithJsQr();
        document.getElementById('cameraStatus').innerText = `Monitorando • resolução ${actualWidth}x${actualHeight} • jsQR ativo`;
    } catch (err) {
        document.getElementById('cameraStatus').innerText = 'Não foi possível iniciar a câmera';
        console.error(err);
    }
});

document.getElementById('btnStopCamera').addEventListener('click', () => {
    html5QrCode.stop().then(() => {
    stopJsQrScan();
        document.getElementById('cameraStatus').innerText = 'Câmera Desligada';
        qrOverlay.hidden = true;
        qrOverlay.dataset.detected = 'false';
        mappingCanvas.hidden = true;
        mappingTrail.length = 0;
        mappingContext.clearRect(0, 0, mappingCanvas.width, mappingCanvas.height);
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

mappingToggle.addEventListener('change', updateMappingVisibility);