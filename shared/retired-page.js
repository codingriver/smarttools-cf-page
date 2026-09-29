try { localStorage.removeItem('smarttools:public-data-cache:v1'); } catch {}
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(registration => registration.update()).catch(() => {});
