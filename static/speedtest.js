(() => {
    const $ = (id) => document.getElementById(id);

    const startBtn = $('startBtn');
    const speedValue = $('speedValue');
    const speedUnit = $('speedUnit');
    const testStatus = $('testStatus');
    const needle = $('needle');
    const gaugeArc = $('gaugeArc');
    const pingValue = $('pingValue');
    const downloadValue = $('downloadValue');
    const uploadValue = $('uploadValue');
    const jitterValue = $('jitterValue');
    const pingCard = $('pingCard');
    const downloadCard = $('downloadCard');
    const uploadCard = $('uploadCard');
    const jitterCard = $('jitterCard');
    const historyBody = $('historyBody');
    const serverUrl = $('serverUrl');
    const serverStatus = $('serverStatus');
    const clearHistory = $('clearHistory');
    const liveSpeed = $('liveSpeed');
    const speedGraph = $('speedGraph');
    const graphCtx = speedGraph.getContext('2d');

    const MAX_GAUGE_SPEED = 100;
    const ARC_LENGTH = 377;
    const DOWNLOAD_STREAMS = 6;
    const UPLOAD_STREAMS = 4;
    const PING_COUNT = 20;
    const TEST_DURATION = 5; // seconds per phase

    let history = JSON.parse(localStorage.getItem('speedtestHistory') || '[]');
    let isRunning = false;
    let graphData = [];
    let animFrame = null;

    // Server URL management
    const savedServer = localStorage.getItem('speedtestServer') || 'dreezy0:8096';
    serverUrl.value = savedServer;

    function baseUrl() {
        let url = serverUrl.value.trim();
        if (!url) return '';
        if (!url.startsWith('http')) {
            url = 'http://' + url;
        }
        if (!url.match(/:\d+$/)) {
            url += ':8096';
        }
        return url.replace(/\/+$/, '');
    }

    function apiUrl(path) {
        return baseUrl() + path;
    }

    serverUrl.addEventListener('change', () => {
        localStorage.setItem('speedtestServer', serverUrl.value.trim());
        checkServer();
    });

    async function checkServer() {
        try {
            const resp = await fetch(apiUrl('/api/info'), { signal: AbortSignal.timeout(3000) });
            if (!resp.ok) throw new Error('bad');
            const data = await resp.json();
            serverStatus.className = 'server-status ok';
            serverStatus.title = `Connected: ${data.name}`;
        } catch {
            serverStatus.className = 'server-status err';
            serverStatus.title = 'Cannot reach server';
        }
    }

    checkServer();
    renderHistory();

    // Gauge
    function setGauge(speed) {
        const fraction = Math.min(speed / MAX_GAUGE_SPEED, 1);
        const angle = -90 + fraction * 180;
        needle.setAttribute('transform', `rotate(${angle}, 150, 150)`);
        gaugeArc.setAttribute('stroke-dasharray', `${fraction * ARC_LENGTH} ${ARC_LENGTH}`);
    }

    function setStatus(msg, state) {
        testStatus.textContent = msg;
        testStatus.className = 'test-status' + (state ? ' ' + state : '');
    }

    function setCard(card, state) {
        card.classList.remove('active', 'done');
        if (state) card.classList.add(state);
    }

    function setCardValue(card, valueEl, val, unit) {
        valueEl.textContent = val;
        if (unit) {
            const sub = card.querySelector('.result-sub');
            if (sub) sub.textContent = unit;
        }
    }

    // Animated speed counter
    function animateValue(el, from, to, duration, suffix) {
        const start = performance.now();
        const diff = to - from;
        function tick(now) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const ease = 1 - Math.pow(1 - progress, 3);
            const current = from + diff * ease;
            el.textContent = current < 10 ? current.toFixed(1) : Math.round(current);
            if (progress < 1) requestAnimationFrame(tick);
        }
        requestAnimationFrame(tick);
    }

    // Live graph
    function showLiveGraph() {
        graphData = [];
        liveSpeed.classList.add('visible');
    }

    function hideLiveGraph() {
        liveSpeed.classList.remove('visible');
        graphData = [];
        if (animFrame) cancelAnimationFrame(animFrame);
    }

    function pushGraphPoint(val) {
        graphData.push(val);
        if (graphData.length > 100) graphData.shift();
        drawGraph();
    }

    function drawGraph() {
        const dpr = window.devicePixelRatio || 1;
        const rect = speedGraph.getBoundingClientRect();
        const cw = rect.width;
        const ch = rect.height;
        speedGraph.width = cw * dpr;
        speedGraph.height = ch * dpr;
        graphCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        graphCtx.clearRect(0, 0, cw, ch);

        if (graphData.length < 2) return;

        const maxVal = Math.max(...graphData, 1);

        graphCtx.beginPath();
        graphCtx.moveTo(0, ch);
        graphData.forEach((v, i) => {
            const x = (i / (graphData.length - 1)) * cw;
            const y = ch - (v / maxVal) * (ch - 8);
            graphCtx.lineTo(x, y);
        });
        graphCtx.lineTo(cw, ch);
        graphCtx.closePath();
        const grad = graphCtx.createLinearGradient(0, 0, 0, ch);
        grad.addColorStop(0, 'rgba(108, 92, 231, 0.3)');
        grad.addColorStop(1, 'rgba(108, 92, 231, 0.0)');
        graphCtx.fillStyle = grad;
        graphCtx.fill();

        graphCtx.beginPath();
        graphData.forEach((v, i) => {
            const x = (i / (graphData.length - 1)) * cw;
            const y = ch - (v / maxVal) * (ch - 8);
            if (i === 0) graphCtx.moveTo(x, y);
            else graphCtx.lineTo(x, y);
        });
        graphCtx.strokeStyle = '#6C5CE7';
        graphCtx.lineWidth = 2;
        graphCtx.stroke();

        graphCtx.fillStyle = 'rgba(255,255,255,0.4)';
        graphCtx.font = '10px Inter, sans-serif';
        graphCtx.textAlign = 'right';
        graphCtx.fillText(maxVal.toFixed(1) + ' Mbps', cw - 4, 14);
    }

    // Main test
    startBtn.addEventListener('click', runTest);

    async function runTest() {
        if (isRunning) return;
        isRunning = true;
        startBtn.disabled = true;
        startBtn.classList.add('running');
        startBtn.querySelector('.go-text').textContent = '...';
        startBtn.querySelector('.go-sub').textContent = 'Testing';

        let pingMs = 0, jitterMs = 0, dlMbps = 0, ulMbps = 0;

        // Reset
        setGauge(0);
        speedValue.textContent = '0';
        speedUnit.textContent = 'Mbps';
        setCardValue(pingCard, pingValue, '--', 'ms');
        setCardValue(downloadCard, downloadValue, '--', 'Mbps');
        setCardValue(uploadCard, uploadValue, '--', 'Mbps');
        setCardValue(jitterCard, jitterValue, '--', 'ms');
        showLiveGraph();

        // --- PING ---
        setCard(pingCard, 'active');
        setStatus('Measuring ping...', 'active');
        try {
            const pings = [];
            for (let i = 0; i < PING_COUNT; i++) {
                const t0 = performance.now();
                await fetch(apiUrl('/api/ping'));
                pings.push(performance.now() - t0);
            }
            pings.sort((a, b) => a - b);
            const mid = Math.floor(pings.length / 2);
            pingMs = pings.length % 2 ? pings[mid] : (pings[mid - 1] + pings[mid]) / 2;
            speedUnit.textContent = 'ms';
            animateValue(speedValue, 0, pingMs, 300);
            setGauge(pingMs);
            setCardValue(pingCard, pingValue, Math.round(pingMs), 'ms');

            let diffs = [];
            for (let i = 1; i < pings.length; i++) {
                diffs.push(Math.abs(pings[i] - pings[i - 1]));
            }
            jitterMs = diffs.reduce((a, b) => a + b, 0) / diffs.length;
            setCardValue(jitterCard, jitterValue, jitterMs.toFixed(1), 'ms');
        } catch (e) {
            pingValue.textContent = 'Error';
            jitterValue.textContent = 'Error';
        }
        setCard(pingCard, 'done');
        setCard(jitterCard, 'done');

        // --- DOWNLOAD (time-based) ---
        setCard(downloadCard, 'active');
        setStatus('Testing download...', 'active');
        speedUnit.textContent = 'Mbps';
        dlMbps = await measureDownload();
        animateValue(speedValue, parseFloat(speedValue.textContent) || 0, dlMbps, 500);
        setGauge(dlMbps);
        setCardValue(downloadCard, downloadValue, dlMbps.toFixed(1), 'Mbps');
        setCard(downloadCard, 'done');

        // --- UPLOAD (time-based) ---
        setCard(uploadCard, 'active');
        setStatus('Testing upload...', 'active');
        ulMbps = await measureUpload();
        animateValue(speedValue, parseFloat(speedValue.textContent) || 0, ulMbps, 500);
        setGauge(ulMbps);
        setCardValue(uploadCard, uploadValue, ulMbps.toFixed(1), 'Mbps');
        setCard(uploadCard, 'done');

        // Done
        setStatus('Test complete', 'done');
        speedUnit.textContent = 'Mbps';
        hideLiveGraph();
        startBtn.disabled = false;
        startBtn.classList.remove('running');
        startBtn.querySelector('.go-text').textContent = 'GO';
        startBtn.querySelector('.go-sub').textContent = 'Start Test';
        isRunning = false;

        // Save history
        const entry = {
            ping: Math.round(pingMs),
            jitter: jitterMs.toFixed(1),
            download: dlMbps.toFixed(1),
            upload: ulMbps.toFixed(1),
            date: new Date().toLocaleString()
        };
        history.unshift(entry);
        if (history.length > 50) history.pop();
        localStorage.setItem('speedtestHistory', JSON.stringify(history));
        renderHistory();
    }

    // Download: parallel streams read for TEST_DURATION seconds
    async function measureDownload() {
        let totalBytes = 0;
        const startTime = performance.now();
        const sample = new Int32Array(60);
        let sampleIdx = 0;

        const controllers = [];
        async function stream(i) {
            const resp = await fetch(apiUrl('/api/download?nocache=' + Date.now() + '_' + i));
            if (!resp.ok || !resp.body) throw new Error('bad response');
            const reader = resp.body.getReader();
            controllers.push(() => reader.cancel());
            const chunk = new Uint8Array(256 * 1024);
            let byteAcc = 0;
            let byteAccTime = performance.now();
            while ((performance.now() - startTime) < TEST_DURATION * 1000) {
                const { value, done } = await reader.read();
                if (done) break;
                if (value) {
                    totalBytes += value.length;
                    byteAcc += value.length;
                    const now = performance.now();
                    if (now - byteAccTime > 200) {
                        const coord = startTime + (TEST_DURATION * 1000);
                        void coord;
                        const inst = (byteAcc * 8) / ((now - byteAccTime) * 1000);
                        sample[sampleIdx % sample.length] = inst;
                        sampleIdx++;
                        byteAcc = 0;
                        byteAccTime = now;
                    }
                }
            }
        }

        const progressTimer = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            const inst = (totalBytes * 8) / (elapsed * 1000000);
            if (elapsed > 0.1) {
                pushGraphPoint(inst);
                speedValue.textContent = inst < 10 ? inst.toFixed(1) : Math.round(inst);
                setGauge(inst);
            }
        }, 100);

        await Promise.allSettled(Array.from({ length: DOWNLOAD_STREAMS }, (_, i) => stream(i)));
        clearInterval(progressTimer);
        controllers.forEach(cancel => { try { cancel(); } catch (e) {} });

        const elapsed = (performance.now() - startTime) / 1000;
        return (totalBytes * 8) / (elapsed * 1000000);
    }

    // Upload: parallel streams, send random data for TEST_DURATION seconds
    async function measureUpload() {
        let totalBytes = 0;
        const startTime = performance.now();

        async function stream(i) {
            const fd = await fetch(apiUrl('/api/upload'), {
                method: 'POST',
                body: getUploadBody(i, startTime),
                duplex: 'half'
            });
            if (fd.ok) {
                const j = await fd.json();
                if (j && j.received) totalBytes += j.received;
            }
        }

        // Stream that generates data until the test duration elapses
        function getUploadBody(streamId, startTimeRef) {
            const encoder = new TextEncoder();
            let running = true;
            const rand = new Uint8Array(256 * 1024);
            crypto.getRandomValues(rand);
            return new ReadableStream({
                pull(controller) {
                    if (!running || (performance.now() - startTimeRef) >= TEST_DURATION * 1000) {
                        running = false;
                        controller.close();
                        return;
                    }
                    crypto.getRandomValues(rand);
                    controller.enqueue(rand.slice(0));
                },
                cancel() { running = false; }
            });
        }

        const progressTimer = setInterval(() => {
            const elapsed = (performance.now() - startTime) / 1000;
            const inst = (totalBytes * 8) / (elapsed * 1000000);
            if (elapsed > 0.1) {
                pushGraphPoint(inst);
                speedValue.textContent = inst < 10 ? inst.toFixed(1) : Math.round(inst);
                setGauge(inst);
            }
        }, 100);

        await Promise.allSettled(Array.from({ length: UPLOAD_STREAMS }, (_, i) => stream(i)));
        clearInterval(progressTimer);

        const elapsed = (performance.now() - startTime) / 1000;
        return (totalBytes * 8) / (elapsed * 1000000);
    }

    // History
    function renderHistory() {
        historyBody.innerHTML = '';
        if (history.length === 0) {
            historyBody.innerHTML = '<tr class="empty-row"><td colspan="6">No tests yet</td></tr>';
            return;
        }
        history.forEach((entry, i) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${history.length - i}</td>
                <td>${entry.ping} ms</td>
                <td>${entry.jitter} ms</td>
                <td>${entry.download} Mbps</td>
                <td>${entry.upload} Mbps</td>
                <td>${entry.date}</td>
            `;
            historyBody.appendChild(tr);
        });
    }

    clearHistory.addEventListener('click', () => {
        if (!confirm('Clear all test history?')) return;
        history = [];
        localStorage.removeItem('speedtestHistory');
        renderHistory();
    });
})();
