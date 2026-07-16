(function () {
    function appendScript(src) {
        return new Promise(function(resolve, reject) {
            var script = document.createElement('script');
            script.src = src;
            script.onload = resolve;
            script.onerror = function() { reject(new Error('script load failed: ' + src)); };
            document.head.appendChild(script);
        });
    }

    function runScript(text, sourceURL) {
        var script = document.createElement('script');
        script.text = String(text || '') + '\n//# sourceURL=' + (sourceURL || 'smarttools-data.js');
        document.head.appendChild(script);
    }

    async function loadData() {
        if (location.protocol === 'file:') {
            await appendScript('data.js');
            return;
        }
        try {
            var response = await fetch('/api/data', { credentials: 'include', cache: 'default' });
            if (!response.ok) throw new Error('/api/data failed: ' + response.status);
            runScript(await response.text(), '/api/data');
        } catch (error) {
            console.warn('online data load failed, fallback to data.js:', error && error.message);
            await appendScript('data.js');
        }
    }

    window.__SmartToolsDataReady = loadData();
})();
