from flask import Flask, request, Response, send_from_directory, jsonify
import os
import time
import socket

app = Flask(__name__)

CHUNK = 256 * 1024
PORT = int(os.environ.get('PORT', 8096))
HOST_NAME = socket.gethostname()


@app.after_request
def add_cors_headers(resp):
    resp.headers['Access-Control-Allow-Origin'] = '*'
    resp.headers['Access-Control-Allow-Methods'] = 'GET, POST, OPTIONS'
    resp.headers['Access-Control-Allow-Headers'] = 'Content-Type'
    resp.headers['Cache-Control'] = 'no-store'
    return resp


@app.route('/')
def index():
    return send_from_directory('templates', 'index.html')


@app.route('/static/<path:filename>')
def serve_static(filename):
    return send_from_directory('static', filename)


@app.route('/api/info')
def info():
    return jsonify({
        'name': HOST_NAME,
        'host': request.host,
        'time': time.time()
    })


@app.route('/api/ping')
def ping():
    return Response('pong', status=200)


@app.route('/api/packet-loss')
def packet_loss():
    # Echoes a sequence number so the client can detect lost/missing
    # packets by counting gaps in the responses it receives.
    seq = request.args.get('seq', '0')
    return Response(seq, status=200, mimetype='text/plain')


@app.route('/api/download')
def download():
    # Streams data continuously until the client disconnects. The client
    # controls the duration (e.g. 5s) and then cancels the request.
    size = request.args.get('size')
    if size and size.isdigit():
        size = int(size)
        size = min(max(size, 64 * 1024), 256 * 1024 * 1024)

        def generate_fixed():
            sent = 0
            while sent < size:
                chunk = os.urandom(min(CHUNK, size - sent))
                sent += len(chunk)
                yield chunk

        resp = Response(generate_fixed(), mimetype='application/octet-stream')
        resp.headers['Content-Length'] = str(size)
        return resp

    # Infinite streaming mode
    def generate_boundless():
        while True:
            yield os.urandom(CHUNK)

    return Response(generate_boundless(), mimetype='application/octet-stream')


@app.route('/api/upload', methods=['POST', 'OPTIONS'])
def upload():
    total = 0
    while True:
        chunk = request.stream.read(CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > 512 * 1024 * 1024:
            break
    return {'received': total}, 200


if __name__ == '__main__':
    print(f"Speedtest server running at http://0.0.0.0:{PORT}")
    app.run(host='0.0.0.0', port=PORT, debug=True, threaded=True)
