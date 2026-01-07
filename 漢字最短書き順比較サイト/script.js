
document.addEventListener('DOMContentLoaded', () => {
    const fileInput = document.getElementById('fileInput');
    const fileNameSpan = document.getElementById('fileName');
    const playBtn = document.getElementById('playBtn');
    const pauseBtn = document.getElementById('pauseBtn');
    const resetBtn = document.getElementById('resetBtn');
    const speedRange = document.getElementById('speedRange');
    const speedValue = document.getElementById('speedValue');

    // UI Containers
    const originalContainer = document.getElementById('originalContainer');
    const shortestContainer = document.getElementById('shortestContainer');

    let originalSVGContent = null;
    let pathsData = []; // Array of { d: string, length: number, startPoint: {x,y}, endPoint: {x,y}, originalIndex: number }

    let originalOrder = []; // Index array
    let shortestOrder = []; // Index array

    let isPlaying = false;
    let isFinished = false;
    let animationId = null;

    // Virtual Time Logic
    let lastFrameTime = 0;
    let currentVirtualTime = 0; // ms

    // Constants
    const STROKE_SPEED = 0.1; // pixels per ms (Base Speed)
    const TRAVEL_SPEED = 0.1; // pixels per ms (Base Speed)
    // Removed START_DELAY to fix slow start at low speeds

    // Speed Slider Listener
    speedRange.addEventListener('input', () => {
        speedValue.textContent = speedRange.value;
    });

    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        fileNameSpan.textContent = file.name;

        try {
            const text = await file.text();
            parseSVG(text);

            // Enable controls
            playBtn.disabled = false;
            resetBtn.disabled = false;

            // Initial Draw (Static, full) or Empty?
            // Let's show the first frame (empty) or reset.
            resetAnimation();

        } catch (err) {
            console.error(err);
            alert('SVGファイルの読み込みに失敗しました。');
        }
    });

    playBtn.addEventListener('click', () => {
        // If finished, reset first (Auto Replay)
        if (isFinished) {
            resetAnimation();
        }

        if (!isPlaying) {
            isPlaying = true;
            isFinished = false; // Playing now
            playBtn.disabled = true;
            pauseBtn.disabled = false;

            // Resume or Start
            lastFrameTime = performance.now();

            loop();
        }
    });

    pauseBtn.addEventListener('click', () => {
        if (isPlaying) {
            isPlaying = false;
            cancelAnimationFrame(animationId);
            playBtn.disabled = false;
            pauseBtn.disabled = true;
        }
    });

    resetBtn.addEventListener('click', () => {
        resetAnimation();
        // Auto Play
        playBtn.click();
    });

    function parseSVG(svgText) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, "image/svg+xml");
        const svgEl = doc.querySelector('svg');

        if (!svgEl) {
            alert("有効なSVGが見つかりませんでした。");
            return;
        }

        // Get viewBox
        const viewBox = svgEl.getAttribute('viewBox') || `0 0 ${svgEl.getAttribute('width')} ${svgEl.getAttribute('height')}`;

        // CRITICAL: We must attach the SVG to the DOM to measure lengths in some browsers.
        // We wrap it in a hidden div.
        const hiddenDiv = document.createElement('div');
        hiddenDiv.style.visibility = 'hidden';
        hiddenDiv.style.position = 'absolute';
        hiddenDiv.style.width = '0';
        hiddenDiv.style.height = '0';
        hiddenDiv.appendChild(svgEl);
        document.body.appendChild(hiddenDiv);

        try {
            // Re-query paths from the now-attached SVG element
            const attachedPaths = Array.from(svgEl.querySelectorAll('path'));

            pathsData = attachedPaths.map((p, i) => {
                const totalLength = p.getTotalLength();
                const start = p.getPointAtLength(0);
                const end = p.getPointAtLength(totalLength);

                // Generate Reversed Path Data by sampling
                const numSamples = Math.ceil(totalLength / 2); // Sample every ~2px
                let reversedPoints = [];
                for (let j = 0; j <= numSamples; j++) {
                    const point = p.getPointAtLength(totalLength - (j * (totalLength / numSamples)));
                    reversedPoints.push(`${point.x},${point.y}`);
                }
                const reversedD = `M${reversedPoints.join(' L')}`;

                return {
                    d: p.getAttribute('d'),
                    reversedD: reversedD,
                    length: totalLength,
                    startPoint: { x: start.x, y: start.y },
                    endPoint: { x: end.x, y: end.y },
                    originalIndex: i
                };
            });
        } finally {
            document.body.removeChild(hiddenDiv);
        }

        // Calculate Orders
        // Original: Force forward direction
        originalOrder = pathsData.map((_, i) => ({ index: i, reverse: false }));
        shortestOrder = calculateShortestPath(pathsData);

        // Store global viewBox for rendering
        window.svgViewBox = viewBox;

        console.log("Original Order Indices:", originalOrder);
        console.log("Shortest Order Indices:", shortestOrder);
    }

    function calculateShortestPath(paths) {
        const N = paths.length;
        if (N === 0) return [];

        let bestOrder = [];
        let minTotalDistance = Infinity;

        // Try every path as a starting point (both Forward and Reverse)
        // 2 * N start possibilities? Or just N start indices, and we choose direction greedily?
        // Let's try starting at i (Forward) and i (Reverse).

        for (let startIdx = 0; startIdx < N; startIdx++) {
            // Try starting Forward and Reverse
            for (let startRev of [false, true]) {
                let currentOrder = [{ index: startIdx, reverse: startRev }];
                let visited = new Set([startIdx]);
                let totalDist = 0;

                let currIdx = startIdx;
                let currRev = startRev;

                // Greedy Nearest Neighbor
                while (visited.size < N) {
                    let nearestIdx = -1;
                    let nearestRev = false;
                    let minDist = Infinity;

                    // Current physical exit point
                    const currentExit = currRev
                        ? paths[currIdx].startPoint // Visual End of Reversed = Physical Start
                        : paths[currIdx].endPoint;  // Visual End of Forward = Physical End

                    for (let nextIdx = 0; nextIdx < N; nextIdx++) {
                        if (!visited.has(nextIdx)) {
                            // Try entering Next as Forward
                            // Visual Start of Forward = Physical Start
                            const distF = getDistance(currentExit, paths[nextIdx].startPoint);
                            if (distF < minDist) {
                                minDist = distF;
                                nearestIdx = nextIdx;
                                nearestRev = false;
                            }

                            // Try entering Next as Reverse
                            // Visual Start of Reverse = Physical End
                            const distR = getDistance(currentExit, paths[nextIdx].endPoint);
                            if (distR < minDist) {
                                minDist = distR;
                                nearestIdx = nextIdx;
                                nearestRev = true;
                            }
                        }
                    }

                    if (nearestIdx !== -1) {
                        currentOrder.push({ index: nearestIdx, reverse: nearestRev });
                        visited.add(nearestIdx);
                        totalDist += minDist;
                        currIdx = nearestIdx;
                        currRev = nearestRev;
                    } else {
                        break;
                    }
                }

                if (totalDist < minTotalDistance) {
                    minTotalDistance = totalDist;
                    bestOrder = currentOrder;
                }
            }
        }
        return bestOrder;
    }

    function getDistance(p1, p2) {
        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        return Math.sqrt(dx * dx + dy * dy);
    }

    function setupVisualization(container, order) {
        container.innerHTML = '';
        if (!window.svgViewBox) return;

        const ns = "http://www.w3.org/2000/svg";
        const svg = document.createElementNS(ns, "svg");
        svg.setAttribute("viewBox", window.svgViewBox);

        // Define Layers
        const defs = document.createElementNS(ns, "defs");
        svg.appendChild(defs);

        const connectorLayer = document.createElementNS(ns, "g");
        connectorLayer.id = "layer-connectors";

        const strokeLayer = document.createElementNS(ns, "g");
        strokeLayer.id = "layer-strokes";

        svg.appendChild(connectorLayer);
        svg.appendChild(strokeLayer);

        let totalAirDistance = 0;

        // Create paths
        order.forEach((item, i) => {
            // item is { index, reverse }
            const pathIndex = item.index;
            const isReversed = item.reverse;
            const data = pathsData[pathIndex];

            // Connector (dotted) from previous end to current start
            if (i > 0) {
                const prevItem = order[i - 1];
                const prevData = pathsData[prevItem.index];

                // Determine physical exit point of previous stroke
                const prevExit = prevItem.reverse
                    ? prevData.startPoint // End of Reversed Path = Start Point
                    : prevData.endPoint;  // End of Forward Path = End Point

                // Determine physical entry point of current stroke
                const currEntry = isReversed
                    ? data.endPoint       // Start of Reversed Path = End Point
                    : data.startPoint;    // Start of Forward Path = Start Point

                // Calculate distance
                const dist = getDistance(prevExit, currEntry);
                totalAirDistance += dist;

                const d = `M${prevExit.x},${prevExit.y} L${currEntry.x},${currEntry.y}`;
                const connectorId = `conn-${container.id}-${i}`;
                const maskId = `mask-${connectorId}`;

                // 1. Create Mask
                const mask = document.createElementNS(ns, "mask");
                mask.setAttribute("id", maskId);

                // Mask Reveal Path (White, Solid) represents the "wiper"
                const maskPath = document.createElementNS(ns, "path");
                maskPath.setAttribute("d", d);
                maskPath.setAttribute("stroke", "white");
                maskPath.setAttribute("stroke-width", "5"); // Slightly wider than the dotted line to ensure coverage
                maskPath.setAttribute("fill", "none");
                maskPath.setAttribute("stroke-linecap", "round");
                // Animate this mask path
                maskPath.style.strokeDasharray = dist;
                maskPath.style.strokeDashoffset = dist; // Hidden initially
                maskPath.id = `mask-path-${connectorId}`;

                mask.appendChild(maskPath);
                defs.appendChild(mask);

                // 2. Create Visible Dotted Line
                const connector = document.createElementNS(ns, "path");
                connector.setAttribute("d", d);
                connector.id = connectorId; // Assign ID
                connector.classList.add("connector-stroke");
                connector.setAttribute("mask", `url(#${maskId})`); // Apply mask
                connector.style.opacity = '0'; // Hide initially

                connectorLayer.appendChild(connector);
            }

            // Main Stroke
            const path = document.createElementNS(ns, "path");
            // Use reversed path data if applicable
            path.setAttribute("d", isReversed ? data.reversedD : data.d);
            path.classList.add("kanji-stroke");
            path.id = `stroke-${container.id}-${i}`;

            path.style.strokeDasharray = data.length;
            path.style.strokeDashoffset = data.length;

            strokeLayer.appendChild(path);
        });

        container.appendChild(svg);

        // Update Stats
        const statsEl = document.getElementById(container.id === 'originalContainer' ? 'originalStats' : 'shortestStats');
        if (statsEl) {
            statsEl.dataset.totalDistance = totalAirDistance; // Store max for final comparison
            statsEl.textContent = `総移動距離: 0px`; // Start at 0
        }

        return totalAirDistance;
    }

    // Compare and highlight
    function updateComparisonStats() {
        const origEl = document.getElementById('originalStats');
        const shortEl = document.getElementById('shortestStats');

        if (!origEl || !shortEl) return;

        const origDist = parseFloat(origEl.dataset.totalDistance || 0);
        const shortDist = parseFloat(shortEl.dataset.totalDistance || 0);

        // Force Final Text
        origEl.textContent = `総移動距離: ${Math.round(origDist)}px`;

        if (origDist > 0 && shortDist > 0) {
            const diff = origDist - shortDist;
            const percent = Math.round((diff / origDist) * 100);

            if (diff > 0) {
                shortEl.innerHTML = `総移動距離: ${Math.round(shortDist)}px <span class="highlight">(-${Math.round(diff)}px, -${percent}%)</span>`;
            } else {
                shortEl.innerHTML = `総移動距離: ${Math.round(shortDist)}px`;
            }
        }
    }

    function loop() {
        const now = performance.now();
        const delta = now - lastFrameTime;
        lastFrameTime = now;

        // Apply Speed Multiplier
        let speed = 1.0;
        try {
            speed = parseFloat(speedRange.value) || 1.0;
        } catch (e) { }

        currentVirtualTime += delta * speed;

        // Update both views
        const done1 = updateView(originalContainer, originalOrder, currentVirtualTime);
        const done2 = updateView(shortestContainer, shortestOrder, currentVirtualTime);

        if (!done1 || !done2) {
            animationId = requestAnimationFrame(loop);
        } else {
            // Both finished
            isPlaying = false;
            isFinished = true; // Mark as done for Replay
            playBtn.disabled = false;
            pauseBtn.disabled = true;

            // Show final stats (with reduction)
            updateComparisonStats();
        }
    }

    function updateView(container, order, elapsed) {
        let localTime = elapsed; // No delay

        let finished = true;
        let currentAirDist = 0;

        // Iterate through sequence
        for (let i = 0; i < order.length; i++) {
            const item = order[i];
            const pathIndex = item.index;
            const isReversed = item.reverse;
            const data = pathsData[pathIndex];
            const strokeEl = container.querySelector(`#stroke-${container.id}-${i}`);

            // 1. Connector (if i > 0)
            if (i > 0) {
                const connectorId = `conn-${container.id}-${i}`;
                const connector = container.querySelector(`#${connectorId}`);
                const maskPathId = `mask-path-${connectorId}`;
                const maskPath = container.querySelector(`#${maskPathId}`);

                // Reveal Connector
                if (connector) connector.style.opacity = '1';

                const prevItem = order[i - 1];
                const prevData = pathsData[prevItem.index];

                // Determine physical exit point of previous stroke
                const prevExit = prevItem.reverse
                    ? prevData.startPoint // End of Reversed Path = Start Point
                    : prevData.endPoint;  // End of Forward Path = End Point

                // Determine physical entry point of current stroke
                const currEntry = isReversed
                    ? data.endPoint       // Start of Reversed Path = End Point
                    : data.startPoint;    // Start of Forward Path = Start Point

                const dist = getDistance(prevExit, currEntry);
                const travelTime = dist / TRAVEL_SPEED;

                if (localTime < travelTime) {
                    // We are currently traveling
                    finished = false;
                    const progress = localTime / travelTime;

                    // Reveal mask
                    maskPath.style.strokeDashoffset = dist * (1 - progress);

                    // Add partial distance to stats
                    currentAirDist += dist * progress;

                    // Ensure current stroke is hidden
                    strokeEl.style.strokeDashoffset = data.length;

                    // Update Stats Text Live
                    updateLiveStats(container, currentAirDist);
                    return false;
                } else {
                    // Travel done
                    maskPath.style.strokeDashoffset = '0'; // Fully visible
                    localTime -= travelTime;
                    currentAirDist += dist; // Fully traveled
                }
            }

            // 2. Draw Stroke
            const drawTime = data.length / STROKE_SPEED;

            if (localTime < drawTime) {
                // Drawing this stroke
                finished = false;
                const progress = localTime / drawTime;
                strokeEl.style.strokeDashoffset = data.length * (1 - progress);

                // Update Stats Text Live (Stats don't change during stroke draw, only during air travel)
                updateLiveStats(container, currentAirDist);
                return false; // Stop processing
            } else {
                // Stroke finished
                strokeEl.style.strokeDashoffset = '0';
                localTime -= drawTime;
            }
        }

        // If finished, set final Stats
        if (finished) {
            // We can just rely on updateComparisonStats at the very end
            // But for smoothness, ensure we show max value
            updateLiveStats(container, currentAirDist);
        }

        return true; // All done
    }

    function updateLiveStats(container, distance) {
        const statsEl = document.getElementById(container.id === 'originalContainer' ? 'originalStats' : 'shortestStats');
        if (statsEl) {
            statsEl.textContent = `総移動距離: ${Math.round(distance)}px`;
        }
    }

    // Refactor Reset Animation to include stats update
    function resetAnimation() {
        isPlaying = false;
        isFinished = false;
        cancelAnimationFrame(animationId);
        playBtn.disabled = false;
        pauseBtn.disabled = true;

        currentVirtualTime = 0;
        lastFrameTime = 0;

        // Clear containers and re-setup DOM
        setupVisualization(originalContainer, originalOrder);
        setupVisualization(shortestContainer, shortestOrder);
    }
});
