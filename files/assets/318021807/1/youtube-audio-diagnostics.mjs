// Attach the official API to the existing iframe. Never issue play/pause commands.
let apiPromise;
function loadApi() {
    if (window.YT?.Player) return Promise.resolve(window.YT);
    if (apiPromise) return apiPromise;
    apiPromise = new Promise((resolve, reject) => {
        const previous = window.onYouTubeIframeAPIReady;
        let timer;
        const ready = () => {
            clearTimeout(timer);
            if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
            try { previous?.(); } finally { resolve(window.YT); }
        };
        window.onYouTubeIframeAPIReady = ready;
        timer = setTimeout(() => {
            if (window.onYouTubeIframeAPIReady === ready) window.onYouTubeIframeAPIReady = previous;
            reject(new Error('YouTube API timed out'));
        }, 15000);
        if (!document.querySelector('script[src="https://www.youtube.com/iframe_api"]')) {
            const script = document.createElement('script');
            script.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(script);
        }
    });
    return apiPromise;
}

export function observeYouTube(iframe, audio) {
    let player;
    let disposed = false;
    const loaded = () => audio.log('youtube:iframe-load', { source: 'iframe load event' });
    iframe.addEventListener('load', loaded);
    audio.log('youtube:iframe-created');
    const host = new URL(iframe.src).hostname;
    if (host === 'www.youtube.com' || host === 'www.youtube-nocookie.com') {
        loadApi().then(YT => {
            if (disposed || !iframe.isConnected) return;
            player = new YT.Player(iframe, { events: {
                onReady: () => audio.log('youtube:ready'),
                onStateChange: event => audio.log('youtube:state', { playerState: event.data }),
                onAutoplayBlocked: () => audio.log('youtube:autoplay-blocked'),
                onError: event => audio.log('youtube:error', { code: event.data })
            } });
        }).catch(error => audio.log('youtube:diagnostics-unavailable', { reason: error.message }));
    }
    return () => {
        disposed = true;
        iframe.removeEventListener('load', loaded);
        audio.log('youtube:iframe-destroyed', { source: 'player teardown or user source change' });
        // Caller only disposes when actually replacing/removing this iframe.
        player?.destroy();
    };
}
