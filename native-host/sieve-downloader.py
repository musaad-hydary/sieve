#!/usr/bin/env python3
"""Native messaging host for Sieve — downloads audio via yt-dlp."""
import sys, json, struct, subprocess, os, shutil

def read_message():
    raw = sys.stdin.buffer.read(4)
    if len(raw) < 4:
        return None
    length = struct.unpack('<I', raw)[0]
    return json.loads(sys.stdin.buffer.read(length))

def send_message(obj):
    data = json.dumps(obj).encode()
    sys.stdout.buffer.write(struct.pack('<I', len(data)) + data)
    sys.stdout.buffer.flush()

def main():
    msg = read_message()
    if not msg:
        send_message({'error': 'No message received'})
        return

    url   = msg.get('url', '').strip()
    fmt   = msg.get('format', 'wav')   # wav | flac | mp3
    start = (msg.get('start') or '').strip()
    end   = (msg.get('end')   or '').strip()

    if not url:
        send_message({'error': 'No URL provided'})
        return

    ytdlp = shutil.which('yt-dlp')
    if not ytdlp:
        send_message({'error': 'yt-dlp not found — install with: brew install yt-dlp'})
        return

    out_dir = os.path.expanduser('~/Downloads/Sieve')
    os.makedirs(out_dir, exist_ok=True)

    cmd = [
        ytdlp,
        '--no-playlist',
        '-x',
        '--audio-format', fmt,
        '--audio-quality', '0',          # best quality VBR
        '-o', os.path.join(out_dir, '%(title)s.%(ext)s'),
    ]

    if start or end:
        sec_start = start or '0'
        sec_end   = end   or 'inf'
        cmd += ['--download-sections', f'*{sec_start}-{sec_end}']
        cmd += ['--force-keyframes-at-cuts']

    cmd.append(url)

    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        if result.returncode == 0:
            send_message({'path': out_dir})
        else:
            lines = result.stderr.strip().splitlines()
            send_message({'error': lines[-1] if lines else 'yt-dlp failed'})
    except subprocess.TimeoutExpired:
        send_message({'error': 'Download timed out (10-min limit)'})
    except Exception as e:
        send_message({'error': str(e)})

if __name__ == '__main__':
    main()
