# Medblaze AI Portal Orchestrator & Supervisor
import os
import sys
import json
import time
import socket
import subprocess
import threading
import webbrowser
import platform
from http.server import SimpleHTTPRequestHandler, HTTPServer
from datetime import datetime

PORTAL_PORT = 8500
PORTAL_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_ROOT = os.path.dirname(PORTAL_DIR)

# Log Buffer to store console outputs for the UI log console
class LogBuffer:
    def __init__(self, max_lines=500):
        self.logs = []
        self.max_lines = max_lines
        self.lock = threading.Lock()

    def log(self, message):
        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        formatted = f"[{timestamp}] {message}"
        print(formatted)
        with self.lock:
            self.logs.append(formatted)
            if len(self.logs) > self.max_lines:
                self.logs.pop(0)

    def get_all(self):
        with self.lock:
            return "\n".join(self.logs)

    def clear(self):
        with self.lock:
            self.logs.clear()

logger = LogBuffer()

# Global process manager state
processes = {}
process_lock = threading.Lock()
supervisor_active = True

class StreamlitSubprocess:
    def __init__(self, app_config):
        self.id = app_config["id"]
        self.name = app_config["name"]
        self.folder = app_config["folder"]
        self.port = app_config["port"]
        self.process = None
        self.restart_count = 0
        self.last_restart_time = 0
        self.should_run = True

    def start(self):
        if not self.should_run:
            return
            
        app_dir = os.path.join(WORKSPACE_ROOT, self.folder)
        if not os.path.exists(app_dir):
            logger.log(f"[ERROR] Directory not found for {self.name}: {app_dir}")
            return

        # Check if port is already in use
        if check_port_listening(self.port):
            logger.log(f"[WARNING] Port {self.port} is already in use. Cannot launch {self.name} on this port.")
            return

        logger.log(f"[PORTAL] Launching {self.name} on port {self.port} (CWD: {self.folder})...")
        
        # Build command using parent python environment execution path
        cmd = [
            sys.executable, "-m", "streamlit", "run", "app.py",
            f"--server.port={self.port}",
            "--server.address=localhost",
            "--server.headless=true"
        ]
        
        try:
            self.process = subprocess.Popen(
                cmd,
                cwd=app_dir,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                bufsize=1
            )
            logger.log(f"[PORTAL] Started {self.name} (PID: {self.process.pid})")
            
            # Start a thread to read and pipe process logs
            threading.Thread(target=self._pipe_logs, daemon=True).start()
            
            self.last_restart_time = time.time()
        except Exception as e:
            logger.log(f"[ERROR] Failed to start {self.name}: {str(e)}")

    def _pipe_logs(self):
        if not self.process:
            return
        for line in iter(self.process.stdout.readline, ''):
            clean_line = line.strip()
            if clean_line:
                logger.log(f"[{self.name}] {clean_line}")
        self.process.stdout.close()

    def is_alive(self):
        if self.process is None:
            return False
        return self.process.poll() is None

    def get_pid(self):
        if self.process:
            return self.process.pid
        return None

    def stop(self):
        self.should_run = False
        if self.process and self.process.poll() is None:
            logger.log(f"[PORTAL] Terminating {self.name} (PID: {self.process.pid})...")
            self.process.terminate()
            try:
                self.process.wait(timeout=3)
            except subprocess.TimeoutExpired:
                logger.log(f"[PORTAL] Force-killing {self.name} (PID: {self.process.pid})...")
                self.process.kill()
        self.process = None

# Quick TCP socket connection test to verify port health
def check_port_listening(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(0.2)
    try:
        s.connect(('127.0.0.1', port))
        s.close()
        return True
    except Exception:
        return False

# Monitor thread to verify processes remain alive and restart crashed ones
def supervisor_loop():
    global supervisor_active
    while supervisor_active:
        time.sleep(2)
        with process_lock:
            for app_id, app_proc in list(processes.items()):
                if app_proc.should_run and not app_proc.is_alive():
                    # Check restart throttling
                    now = time.time()
                    if now - app_proc.last_restart_time < 10:
                        app_proc.restart_count += 1
                    else:
                        app_proc.restart_count = 1
                        
                    if app_proc.restart_count > 5:
                        logger.log(f"[CRITICAL] {app_proc.name} crashed repeatedly. Disabling auto-restart.")
                        app_proc.should_run = False
                    else:
                        logger.log(f"[WARNING] {app_proc.name} stopped unexpectedly. Restarting (Attempt {app_proc.restart_count})...")
                        app_proc.start()

# Load apps from portal_config.json
def load_apps_config():
    config_path = os.path.join(PORTAL_DIR, "portal_config.json")
    try:
        with open(config_path, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.log(f"[ERROR] Failed to load portal_config.json: {str(e)}")
        return []

# Custom Request Handler for Serving Static files + API Endpoints
class PortalHTTPRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=PORTAL_DIR, **kwargs)

    def do_GET(self):
        # 1. API: Get process/health status of all applications
        if self.path == '/api/status':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            status_list = []
            apps_config = load_apps_config()
            
            with process_lock:
                for app in apps_config:
                    if app.get("placeholder"):
                        continue
                        
                    app_id = app["id"]
                    app_proc = processes.get(app_id)
                    
                    pid = None
                    status = "offline"
                    
                    if app_proc:
                        pid = app_proc.get_pid()
                        if app_proc.is_alive():
                            # Process is running, but has the port bound yet?
                            if check_port_listening(app["port"]):
                                status = "online"
                            else:
                                status = "starting"
                                
                    status_list.append({
                        "id": app_id,
                        "name": app["name"],
                        "folder": app["folder"],
                        "port": app["port"],
                        "pid": pid,
                        "status": status
                    })
                    
            self.wfile.write(json.dumps(status_list).encode())
            return
            
        # 2. API: Fetch log console outputs
        elif self.path.startswith('/api/logs'):
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self.end_headers()
            self.wfile.write(logger.get_all().encode())
            return

        # 3. API: Fetch system load metrics (CPU, Memory, System Info)
        elif self.path == '/api/system':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            
            cpu = 0
            mem = 0
            
            # Non-blocking OS query for CPU and memory usage (dependency free)
            try:
                import psutil
                cpu = int(psutil.cpu_percent())
                mem = int(psutil.virtual_memory().percent)
            except ImportError:
                # Windows command line fallbacks
                if platform.system() == 'Windows':
                    try:
                        out = subprocess.check_output("wmic cpu get loadpercentage", shell=True).decode()
                        lines = [l.strip() for l in out.splitlines() if l.strip()]
                        if len(lines) > 1:
                            cpu = int(lines[1])
                    except Exception:
                        pass
                    try:
                        out = subprocess.check_output("wmic OS get FreePhysicalMemory,TotalVisibleMemorySize", shell=True).decode()
                        lines = [l.strip() for l in out.splitlines() if l.strip()]
                        if len(lines) > 1:
                            parts = lines[1].split()
                            if len(parts) == 2:
                                free = int(parts[0])
                                total = int(parts[1])
                                mem = int((total - free) / total * 100)
                    except Exception:
                        pass
            
            sys_info = {
                "cpu": cpu,
                "memory": mem,
                "python_version": platform.python_version(),
                "portal_port": PORTAL_PORT
            }
            self.wfile.write(json.dumps(sys_info).encode())
            return

        # Serve static assets
        return super().do_GET()

    def do_POST(self):
        # 4. API: Console clear command
        if self.path.startswith('/api/logs?clear=true'):
            logger.clear()
            self.send_response(200)
            self.end_headers()
            self.wfile.write(b"OK")
            return
            
        # 5. API: Control endpoints (restart app process)
        elif self.path.startswith('/api/control'):
            from urllib.parse import urlparse, parse_qs
            parsed = urlparse(self.path)
            params = parse_qs(parsed.query)
            
            app_id = params.get('app', [None])[0]
            action = params.get('action', [None])[0]
            
            if app_id and action == 'restart':
                with process_lock:
                    app_proc = processes.get(app_id)
                    if app_proc:
                        logger.log(f"[PORTAL] User requested restart of {app_proc.name}...")
                        app_proc.stop()
                        app_proc.should_run = True
                        app_proc.start()
                        self.send_response(200)
                        self.end_headers()
                        self.wfile.write(b"OK")
                        return
                        
            self.send_response(400)
            self.end_headers()
            self.wfile.write(b"Invalid Parameters")
            return
            
        self.send_response(404)
        self.end_headers()

# Helper to automatically open browser link
def open_browser():
    time.sleep(1.5)
    url = f"http://localhost:{PORTAL_PORT}"
    logger.log(f"[PORTAL] Launching default browser to: {url}")
    webbrowser.open(url)

# Clean shutdown function
def shutdown():
    global supervisor_active
    supervisor_active = False
    logger.log("[PORTAL] Initiating shutdown sequence...")
    with process_lock:
        for name, app_proc in processes.items():
            app_proc.stop()
    logger.log("[PORTAL] Shutdown complete. Exiting.")

def main():
    logger.log("=========================================")
    logger.log("    MEDBLAZE CONFIGURATION HUB ORCH      ")
    logger.log("=========================================")
    logger.log(f"Portal Path: {PORTAL_DIR}")
    logger.log(f"Workspace Path: {WORKSPACE_ROOT}")
    
    # 1. Load application configurations
    apps_config = load_apps_config()
    
    # 2. Check if portal port is available
    if check_port_listening(PORTAL_PORT):
        print(f"[FATAL] Port {PORTAL_PORT} is already in use. Please close the running application or free the port.")
        sys.exit(1)
        
    # 3. Create process supervisors
    for app in apps_config:
        if app.get("placeholder"):
            continue
        app_id = app["id"]
        processes[app_id] = StreamlitSubprocess(app)
        
    # 4. Start all applications
    with process_lock:
        for name, app_proc in processes.items():
            app_proc.start()
            
    # 5. Start supervisor thread
    threading.Thread(target=supervisor_loop, daemon=True).start()
    
    # 6. Start browser autolauncher thread
    threading.Thread(target=open_browser, daemon=True).start()
    
    # 7. Run HTTP Portal Web Server
    server = HTTPServer(('0.0.0.0', PORTAL_PORT), PortalHTTPRequestHandler)
    logger.log(f"[PORTAL] Medblaze Configuration Hub running at http://localhost:{PORTAL_PORT}")
    
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        shutdown()

if __name__ == '__main__':
    main()
