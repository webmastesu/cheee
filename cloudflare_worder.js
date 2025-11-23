/**
 * Cloudflare Worker - Secure Video Proxy
 * 
 * This proxies video requests to hide the original streaming URL
 * 
 * Flow:
 * 1. App sends encrypted video ID
 * 2. Worker decrypts to get original URL
 * 3. Worker fetches from original server
 * 4. Worker streams back to app
 * 5. Original URL never exposed to client
 * 
 * Bandwidth: FREE (Cloudflare handles it)
 */

addEventListener('fetch', event => {
    event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
    // Handle CORS preflight
    if (request.method === 'OPTIONS') {
        return new Response(null, {
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                'Access-Control-Allow-Headers': 'Range, Content-Type',
            }
        })
    }

    try {
        const url = new URL(request.url)

        // Get encrypted video ID from query parameter
        const encryptedId = url.searchParams.get('vid')

        if (!encryptedId) {
            return new Response(JSON.stringify({ error: 'Missing video ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        // Decrypt video ID (Base64 for now, upgrade to AES later)
        let originalUrl
        try {
            originalUrl = atob(encryptedId)
        } catch (e) {
            return new Response(JSON.stringify({ error: 'Invalid video ID' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        // Validate URL
        if (!originalUrl.startsWith('http://') && !originalUrl.startsWith('https://')) {
            return new Response(JSON.stringify({ error: 'Invalid URL' }), {
                status: 400,
                headers: { 'Content-Type': 'application/json' }
            })
        }

        // Optional: Whitelist allowed domains (uncomment to enable)
        /*
        const allowedDomains = [
          'commondatastorage.googleapis.com',
          'storage.googleapis.com',
          // Add your streaming domains here
        ]
        
        const urlObj = new URL(originalUrl)
        const isAllowed = allowedDomains.some(domain => urlObj.hostname.includes(domain))
        
        if (!isAllowed) {
          return new Response(JSON.stringify({ error: 'Unauthorized domain' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' }
          })
        }
        */

        // Build request to original streaming server
        const videoRequest = new Request(originalUrl, {
            method: request.method,
            headers: {
                // Forward important headers
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Accept': request.headers.get('Accept') || '*/*',
                'Accept-Language': 'en-US,en;q=0.9',
                // Forward range header for seeking
                'Range': request.headers.get('Range') || '',
            }
        })

        // Fetch from original streaming server
        // The client will NEVER see this URL - only Cloudflare does!
        const videoResponse = await fetch(videoRequest)

        // Forward response to client
        const responseHeaders = new Headers({
            // Forward essential headers
            'Content-Type': videoResponse.headers.get('Content-Type') || 'video/mp4',
            'Accept-Ranges': videoResponse.headers.get('Accept-Ranges') || 'bytes',

            // CORS headers
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
            'Access-Control-Allow-Headers': 'Range, Content-Type',

            // Cache control (Cloudflare auto-caches popular content)
            'Cache-Control': 'public, max-age=3600',
        })

        // Forward content length if present
        if (videoResponse.headers.has('Content-Length')) {
            responseHeaders.set('Content-Length', videoResponse.headers.get('Content-Length'))
        }

        // Forward content range if present (for partial content)
        if (videoResponse.headers.has('Content-Range')) {
            responseHeaders.set('Content-Range', videoResponse.headers.get('Content-Range'))
        }

        // Return video content
        // Cloudflare automatically caches this at edge servers globally
        return new Response(videoResponse.body, {
            status: videoResponse.status,
            headers: responseHeaders
        })

    } catch (error) {
        return new Response(JSON.stringify({
            error: 'Server error',
            message: error.message
        }), {
            status: 500,
            headers: { 'Content-Type': 'application/json' }
        })
    }
}
