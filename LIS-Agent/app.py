import tkinter as tk
from tkinter import ttk, messagebox
import json
import math
import threading
import time
import serial
import struct
import requests
import os

CONFIG_FILE = "config.json"
running = False

# ======================
# LOAD / SAVE CONFIG
# ======================
def load_config():
    if os.path.exists(CONFIG_FILE):
        with open(CONFIG_FILE) as f:
            return json.load(f)
    return []

def save_config(data):
    with open(CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)

analyzers = load_config()

# ======================
# EIAQuant — constants
# ======================
_BURST_SIZE   = 4106
_CONFIG_START = 0
_CONFIG_SIZE  = 626
_SINFO_START  = 626
_OD_START     = 2578
_OD_SIZE      = 977
_OD_DBL_OFF   = 0x0187
_OD_MAX_ROWS  = 12
_RESULT_START = 3555
_RESULT_SIZE  = 551

_CFG_FILTER1  = 0x0065
_CFG_FILTER2  = 0x0068
_CFG_TEST     = 0x006B
_CFG_DAY      = 0x0173
_CFG_MON      = 0x0174
_CFG_YEAR     = 0x0175
_CFG_HOUR     = 0x0176
_CFG_MIN      = 0x0177
_CFG_WTYPES   = 0x0179
_CFG_WELLS    = 0x01D9

_SI_ID_FIRST  = 0x27
_SI_ID_SLOT   = 16

_RES_CUTOFF   = 0x015C

_FILTER_WL    = {"CL1": 450, "CL2": 630}
_WTYPE_LABEL  = {"N": "NC",  "P": "PC"}
_ROW_NAMES    = "ABCDEFGHIJKL"
_IDLE_GAP     = 0.5

# ======================
# EIAQuant — parsers
# ======================
def _eia_parse_config(data: bytes):
    if len(data) < 0x01E5 or data[0] != 0xAA or data[1] != 0x00:
        return None
    day    = data[_CFG_DAY]
    month  = data[_CFG_MON]
    year   = data[_CFG_YEAR]
    hour   = data[_CFG_HOUR]
    minute = data[_CFG_MIN]
    f1   = data[_CFG_FILTER1:_CFG_FILTER1+3].decode("ascii", errors="ignore").strip("\x00 ")
    f2   = data[_CFG_FILTER2:_CFG_FILTER2+3].decode("ascii", errors="ignore").strip("\x00 ")
    test = data[_CFG_TEST:_CFG_TEST+15].decode("ascii", errors="ignore").strip("\x00 ")
    wl1  = _FILTER_WL.get(f1, f1)
    wl2  = _FILTER_WL.get(f2, f2)
    active_rows = [i + 1 for i, b in enumerate(data[_CFG_WELLS:_CFG_WELLS + 12]) if b != 0]
    raw_types   = data[_CFG_WTYPES:_CFG_WTYPES + len(active_rows)]
    well_types  = [chr(b) if 32 <= b <= 126 else "" for b in raw_types]
    return {
        "run_date":    f"{day:02d}/{month:02d}/{year:02d}",
        "print_time":  f"{day:02d}/{month:02d}/{year:02d} {hour:02d}:{minute:02d}",
        "test":        test,
        "filter":      f"{wl1}-{wl2}",
        "active_rows": active_rows,
        "well_types":  well_types,
    }


def _eia_parse_od(data: bytes):
    if len(data) < _OD_DBL_OFF + 8 or data[:4] != bytes(4):
        return None
    probe = []
    for i in range(4):
        off = _OD_DBL_OFF + i * 8
        if off + 8 > len(data):
            break
        probe.append(struct.unpack("<d", data[off:off + 8])[0])
    if not probe or all(v == 0.0 for v in probe):
        return None
    if any(not math.isfinite(v) or v < 0 for v in probe):
        return None
    return [
        struct.unpack("<d", data[_OD_DBL_OFF + i * 8:_OD_DBL_OFF + i * 8 + 8])[0]
        for i in range(_OD_MAX_ROWS)
        if _OD_DBL_OFF + i * 8 + 8 <= len(data)
    ]


def _eia_parse_cutoff(result_pkt: bytes):
    off = _RES_CUTOFF
    if off + 8 > len(result_pkt):
        return None
    v = struct.unpack("<d", result_pkt[off:off + 8])[0]
    return v if math.isfinite(v) and 0.001 < v < 10.0 else None


def _eia_parse_sample_ids(burst: bytes, n_wells: int):
    ids = []
    for i in range(n_wells):
        start = _SINFO_START + _SI_ID_FIRST + i * _SI_ID_SLOT
        slot  = burst[start:start + _SI_ID_SLOT]
        if len(slot) < _SI_ID_SLOT or all(b == 0xFF for b in slot):
            ids.append("")
        else:
            ids.append(slot.split(b"\x00")[0].decode("ascii", errors="ignore").strip())
    return ids


def _eia_fmt_od(v: float) -> str:
    if abs(v) < 1e-10:
        return "0"
    return f"{int(v * 10000) / 10000:.4f}".rstrip("0").rstrip(".")


def _eia_well_result(wtype: str, od: float, cutoff) -> str:
    if cutoff is None:
        return ""
    if wtype in _WTYPE_LABEL:
        return "PASS" if od < cutoff else "FAIL"
    return "R" if od >= cutoff else "NR"


def _eia_build_payload(cfg: dict, od: list, sample_ids: list, cutoff) -> dict:
    is_qualitative = cfg["test"] not in ("ABS",)
    wells = []
    for idx, row in enumerate(cfg["active_rows"]):
        wtype  = cfg["well_types"][idx] if idx < len(cfg["well_types"]) else ""
        sid    = sample_ids[idx] if idx < len(sample_ids) else ""
        od_val = od[row - 1] if (row - 1) < len(od) else 0.0
        wells.append({
            "well":   _ROW_NAMES[row - 1] + "1",
            "id":     _WTYPE_LABEL.get(wtype, sid) if is_qualitative else "",
            "od":     round(od_val, 6),
            "result": _eia_well_result(wtype, od_val, cutoff) if is_qualitative else "",
        })
    return {
        "instrument": "Meril EIAQuant",
        "test":       cfg["test"],
        "filter":     cfg["filter"],
        "run_date":   cfg["run_date"],
        "print_time": cfg["print_time"],
        "cutoff":     round(cutoff, 6) if cutoff is not None else None,
        "wells":      wells,
    }


def _eia_process_burst(burst: bytes):
    n = len(burst)
    log(f"[EIAQuant RX {n} bytes]")
    if n != _BURST_SIZE:
        log(f"  Unexpected burst size {n}, skipping")
        return None
    cfg = _eia_parse_config(burst[_CONFIG_START:_CONFIG_START + _CONFIG_SIZE])
    if not cfg:
        log("  [Config packet invalid]")
        return None
    od = _eia_parse_od(burst[_OD_START:_OD_START + _OD_SIZE])
    if not od:
        log("  [OD packet: no valid data]")
        return None
    sample_ids = _eia_parse_sample_ids(burst, len(cfg["active_rows"]))
    cutoff     = _eia_parse_cutoff(burst[_RESULT_START:_RESULT_START + _RESULT_SIZE])
    log(f"  Test={cfg['test']} | Wells={len(cfg['active_rows'])} | "
        f"CutOff={_eia_fmt_od(cutoff) if cutoff is not None else 'N/A'}")
    return _eia_build_payload(cfg, od, sample_ids, cutoff)

# ======================
# SERIAL LISTENER — CliniQuant Micro (frame-based)
# ======================
def serial_listener(config):
    global running
    try:
        ser = serial.Serial(config["port"], config["baud"], timeout=1)
        buffer = bytearray()
        log("🔌 Listening...")
        while running:
            if ser.in_waiting:
                buffer += ser.read(ser.in_waiting)
                if 0xAA in buffer and 0xF5 in buffer:
                    start = buffer.index(0xAA)
                    end   = buffer.index(0xF5)
                    frame = buffer[start:end + 1]
                    data  = parse_data(frame)
                    if data:
                        log(f"✅ {data}")
                        send_to_server(config["server"], data)
                    buffer = bytearray()
    except Exception as e:
        log(f"❌ Error: {e}")

# ======================
# SERIAL LISTENER — Meril EIAQuant (burst-based)
# ======================
def serial_listener_eiaquant(config):
    global running
    try:
        ser     = serial.Serial(config["port"], config["baud"], timeout=0.1)
        buf     = bytearray()
        last_rx = None
        log("🔌 EIAQuant listening...")
        while running:
            chunk = ser.read(ser.in_waiting or 1)
            if chunk:
                buf.extend(chunk)
                last_rx = time.monotonic()
                continue
            if not buf or last_rx is None:
                continue
            if (time.monotonic() - last_rx) < _IDLE_GAP:
                continue
            burst   = bytes(buf)
            buf     = bytearray()
            last_rx = None
            payload = _eia_process_burst(burst)
            if payload:
                log(f"✅ {payload['test']} — {len(payload['wells'])} wells")
                send_to_server(config["server"], payload)
    except Exception as e:
        log(f"❌ Error: {e}")

# ======================
# PARSER — CliniQuant Micro
# ======================
def parse_data(frame):
    try:
        return {
            "test_code":  frame[1],
            "patient_id": frame[3:9].decode(),
            "result":     struct.unpack('>f', frame[9:13])[0]
        }
    except:
        return None

# ======================
# SEND
# ======================
def send_to_server(url, data):
    try:
        requests.post(url, json=data)
        log("🚀 Sent to server")
    except:
        log("❌ Send failed")

# ======================
# UI FUNCTIONS
# ======================
def add_analyzer():
    data = {
        "name":   name_var.get(),
        "type":   type_var.get(),
        "port":   port_var.get(),
        "baud":   int(baud_var.get()),
        "server": server_var.get()
    }
    analyzers.append(data)
    save_config(analyzers)
    refresh_list()

def refresh_list():
    listbox.delete(0, tk.END)
    for a in analyzers:
        listbox.insert(tk.END, a["name"])

def start():
    global running
    if running:
        return
    selected = listbox.curselection()
    if not selected:
        messagebox.showerror("Error", "Select analyzer")
        return
    config  = analyzers[selected[0]]
    running = True
    log(f"▶ Starting {config['name']} ({config.get('type', 'unknown')})")
    target = serial_listener_eiaquant if config.get("type") == "Meril EIAQuant" else serial_listener
    threading.Thread(target=target, args=(config,), daemon=True).start()

def stop():
    global running
    running = False
    log("⏹ Stopped")

def log(msg):
    log_box.insert(tk.END, msg + "\n")
    log_box.see(tk.END)

# ======================
# UI LAYOUT
# ======================
root = tk.Tk()
root.title("LIS Agent")
root.geometry("600x560")

tk.Label(root, text="Add Analyzer", font=("", 10, "bold")).pack(pady=(8, 0))

name_var   = tk.StringVar()
type_var   = tk.StringVar(value="CliniQuant Micro")
port_var   = tk.StringVar()
baud_var   = tk.StringVar(value="9600")
server_var = tk.StringVar(value="http://localhost:3000/api")

form = tk.Frame(root)
form.pack(fill="x", padx=12)

for label, var, widget_factory in [
    ("Name",       name_var,   lambda f, v: tk.Entry(f, textvariable=v)),
    ("Type",       type_var,   lambda f, v: ttk.Combobox(f, textvariable=v,
                                    values=["CliniQuant Micro", "Meril EIAQuant"],
                                    state="readonly")),
    ("Port",       port_var,   lambda f, v: tk.Entry(f, textvariable=v)),
    ("Baud",       baud_var,   lambda f, v: tk.Entry(f, textvariable=v)),
    ("Server URL", server_var, lambda f, v: tk.Entry(f, textvariable=v)),
]:
    row = tk.Frame(form)
    row.pack(fill="x", pady=2)
    tk.Label(row, text=label, width=10, anchor="w").pack(side="left")
    widget_factory(row, var).pack(side="left", fill="x", expand=True)

tk.Button(root, text="Add Analyzer", command=add_analyzer).pack(pady=4)

listbox = tk.Listbox(root, height=4)
listbox.pack(fill="x", padx=12)

btn_frame = tk.Frame(root)
btn_frame.pack()
tk.Button(btn_frame, text="▶ Start", command=start, width=10).pack(side="left", padx=4, pady=4)
tk.Button(btn_frame, text="⏹ Stop",  command=stop,  width=10).pack(side="left", padx=4, pady=4)

log_box = tk.Text(root, font=("Courier", 9))
log_box.pack(fill="both", expand=True, padx=12, pady=(0, 8))

refresh_list()
root.mainloop()
