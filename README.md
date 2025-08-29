#  Wi-Fi Strength & Dead Zone Detector

A real-time **Wi-Fi signal strength scanner and heatmap visualizer** that helps detect weak connectivity zones ("dead spots") in your environment.  
It combines background Wi-Fi scanning with an interactive Flask web app that streams live data and lets users map signal strength visually.

---

##  Features
-   **Wi-Fi Signal Scanner** – Continuously measures RSSI values using `nmcli` (Linux) or `netsh` (Windows).  
-   **Live Dashboard** – Real-time visualization with Flask + Socket.IO.  
-   **CSV Logging** – Automatically stores scans in a structured CSV file for offline analysis.  
-   **Interactive Heatmap** – Mark physical spots (with camera snapshots) and visualize signal strength distribution.  
-   **Camera Integration** – Uses OpenCV to stream a live feed while tagging weak/strong zones.  
-   **Export Data** – Download collected Wi-Fi strength logs with one click.  

---

## 🛠 Tech Stack
- **Backend:** Python, Flask, Flask-SocketIO  
- **Frontend:** HTML, CSS, JavaScript  
- **Networking:** `nmcli` (Linux), `netsh` (Windows)  
- **Visualization:** OpenCV (camera feed), CSV-based heatmap plotting  

---

##   Installation & Setup

### 1. Clone the repo
```bash
git clone https://github.com/rohithkumar2027/Wifi-Signal-Heatmap.git
cd Wifi-Signal-Heatmap
