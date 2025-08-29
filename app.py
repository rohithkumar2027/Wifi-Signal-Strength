import os
import sys
import time
import csv
import io
import base64
import threading
import platform
from datetime import datetime, timezone

from flask import Flask, render_template, Response, send_file, jsonify
from flask_socketio import SocketIO, emit
import subprocess
import cv2
import numpy as np

APP_ROOT = os.path.dirname(__file__)
LOG_CSV = os.path.join(APP_ROOT, "wifi_log.csv")

app = Flask(__name__)
app.config['SECRET_KEY'] = 'change-me'
# Use eventlet or threading; if eventlet unavailable, it will fall back during install
socketio = SocketIO(app, cors_allowed_origins="*", async_mode='eventlet')

# Global storage for live values & collected points
latest_scan = {"timestamp": None, "ssid": None, "bssid": None, "signal_pct": None}
points_lock = threading.Lock()
# Each point: dict {x: float (0..1), y: float (0..1), signal: int, ts: timestamp, label:optional}
points = []

# Camera capture (0 default camera) — we keep it but also offer browser fallback
video_capture = cv2.VideoCapture(0)


def ensure_log_exists():
    if not os.path.exists(LOG_CSV):
        with open(LOG_CSV, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['timestamp', 'ssid', 'bssid', 'signal_pct', 'x', 'y', 'label'])


def append_log_row(row):
    with open(LOG_CSV, 'a', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(row)


def parse_nmcli():
    try:
        cmd = ["nmcli", "-t", "-f", "IN-USE,SSID,SIGNAL,BSSID", "dev", "wifi"]
        out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL, text=True)
        for line in out.splitlines():
            parts = line.split(":")
            if len(parts) >= 4 and parts[0] == '*':
                ssid = parts[1]
                signal = parts[2]
                bssid = parts[3]
                try:
                    signal_pct = int(signal)
                except:
                    signal_pct = None
                return ssid, bssid, signal_pct
        return None, None, None
    except Exception:
        return None, None, None


def parse_netsh():
    try:
        out = subprocess.check_output(["netsh", "wlan", "show", "interfaces"], text=True, stderr=subprocess.DEVNULL)
        ssid = None
        bssid = None
        signal_pct = None
        for line in out.splitlines():
            line = line.strip()
            if line.startswith("SSID") and ":" in line:
                parts = line.split(":", 1)
                if len(parts) == 2 and parts[0].strip().startswith("SSID"):
                    ssid = parts[1].strip()
            if line.startswith("BSSID") and ":" in line:
                parts = line.split(":", 1)
                bssid = parts[1].strip()
            if line.startswith("Signal") and ":" in line:
                parts = line.split(":", 1)
                val = parts[1].strip().rstrip('%')
                try:
                    signal_pct = int(val)
                except:
                    signal_pct = None
        return ssid, bssid, signal_pct
    except Exception:
        return None, None, None


def get_current_signal():
    system = platform.system()
    if system == "Windows":
        return parse_netsh()
    else:
        ssid, bssid, sig = parse_nmcli()
        if sig is not None:
            return ssid, bssid, sig
        return parse_netsh()


def wifi_scanner_loop(poll_interval=2.0):
    ensure_log_exists()
    while True:
        ssid, bssid, signal_pct = get_current_signal()
        ts = datetime.now(timezone.utc).isoformat()
        latest_scan.update({"timestamp": ts, "ssid": ssid, "bssid": bssid, "signal_pct": signal_pct})
        socketio.emit('signal_update', latest_scan)
        append_log_row([ts, ssid, bssid, signal_pct, '', '', ''])
        time.sleep(poll_interval)


@app.route('/')
def index():
    return render_template('index.html')


@app.route('/wifi_log.csv')
def download_log():
    # serve the CSV as an attachment
    ensure_log_exists()
    return send_file(LOG_CSV, mimetype='text/csv', as_attachment=True, download_name='wifi_log.csv')


def gen_camera_frames():
    global video_capture
    if not video_capture.isOpened():
        try:
            video_capture.open(0)
        except:
            pass
        if not video_capture.isOpened():
            img = np.ones((480, 640, 3), dtype=np.uint8) * 100
            _, jpeg = cv2.imencode('.jpg', img)
            frame = jpeg.tobytes()
            while True:
                yield (b'--frame\r\n'
                       b'Content-Type: image/jpeg\r\n\r\n' + frame + b'\r\n')
    while True:
        ret, frame = video_capture.read()
        if not ret:
            time.sleep(0.05)
            continue
        frame = cv2.resize(frame, (640, 480))
        _, jpeg = cv2.imencode('.jpg', frame)
        frame_bytes = jpeg.tobytes()
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_bytes + b'\r\n')


@app.route('/video_feed')
def video_feed():
    return Response(gen_camera_frames(),
                    mimetype='multipart/x-mixed-replace; boundary=frame')


@socketio.on('connect')
def on_connect():
    # send latest scan and all points
    emit('signal_update', latest_scan)
    with points_lock:
        emit('all_points', points)


@socketio.on('add_point')
def on_add_point(data):
    x = float(data.get('x', 0.5))
    y = float(data.get('y', 0.5))
    label = data.get('label', '')
    sig = latest_scan.get('signal_pct')
    ts = datetime.now(timezone.utc).isoformat()
    with points_lock:
        points.append({'x': x, 'y': y, 'signal': sig, 'ts': ts, 'label': label})
        pts_copy = points.copy()
    append_log_row([ts, latest_scan.get('ssid'), latest_scan.get('bssid'), sig, x, y, label])
    # broadcast new points list
    socketio.emit('all_points', pts_copy)
    emit('point_added', {'x': x, 'y': y, 'signal': sig, 'ts': ts})


def start_background_threads():
    t = threading.Thread(target=wifi_scanner_loop, daemon=True)
    t.start()


if __name__ == "__main__":
    print("Ensuring log exists...", flush=True)
    ensure_log_exists()
    print("Starting background threads...", flush=True)
    start_background_threads()
    print("Launching server on http://127.0.0.1:5000", flush=True)
    socketio.run(app, host="0.0.0.0", port=5000)