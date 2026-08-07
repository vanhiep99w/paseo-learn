# Hướng dẫn dùng Codex profile với Paseo

## Mục đích

Paseo khởi động Codex thông qua `codex app-server`, trong khi Codex không hỗ trợ:

```powershell
codex --profile root app-server
```

Giải pháp trong tài liệu này dùng một launcher chung để:

1. Đọc file `~/.codex/<profile>.config.toml`.
2. Chuyển từng giá trị thành tham số `-c key=value`.
3. Chạy `codex app-server` trên `CODEX_HOME` hiện tại.

Không cần tạo runtime riêng, merge `config.toml`, symlink hay launcher riêng cho từng profile.

## Yêu cầu

- Windows và Paseo đã được cài đặt.
- `codex` có trong `PATH`.
- Python 3.11 trở lên, vì launcher sử dụng `tomllib` trong thư viện chuẩn.

Kiểm tra:

```powershell
codex --version
python --version
paseo --version
```

## Cấu trúc file

```text
~/.codex/
├── config.toml
├── root.config.toml
├── supervisor.config.toml
└── peer.config.toml

~/.paseo/
├── config.json
└── bin/
    ├── codex-profile.cmd
    └── codex-profile.py
```

`~/.codex/config.toml` tiếp tục chứa cấu hình chung như MCP, plugins, skills, trusted projects và giao diện. Các file `<profile>.config.toml` chỉ cần chứa phần khác biệt của từng role.

## 1. Tạo launcher Python

Tạo file `~/.paseo/bin/codex-profile.py`:

```python
#!/usr/bin/env python3
"""Launch Codex with a TOML profile translated to CLI config overrides."""

from __future__ import annotations

import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tomllib
from typing import Any, Iterator


BARE_KEY = re.compile(r"^[A-Za-z0-9_-]+$")


def key(value: str) -> str:
    return value if BARE_KEY.fullmatch(value) else json.dumps(value, ensure_ascii=False)


def encode(value: Any) -> str:
    if isinstance(value, str):
        return json.dumps(value, ensure_ascii=False)
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        if math.isnan(value):
            return "nan"
        if math.isinf(value):
            return "inf" if value > 0 else "-inf"
        return repr(value)
    if isinstance(value, (dt.datetime, dt.date, dt.time)):
        return value.isoformat()
    if isinstance(value, list):
        return "[" + ", ".join(encode(item) for item in value) + "]"
    if isinstance(value, dict):
        fields = ", ".join(f"{key(name)} = {encode(item)}" for name, item in value.items())
        return "{ " + fields + " }"
    raise TypeError(f"Unsupported TOML value: {type(value).__name__}")


def overrides(table: dict[str, Any], path: tuple[str, ...] = ()) -> Iterator[str]:
    for name, value in table.items():
        current = path + (name,)
        if isinstance(value, dict) and value:
            yield from overrides(value, current)
        elif not isinstance(value, dict):
            yield f"{'.'.join(key(part) for part in current)}={encode(value)}"


def profile_path(selector: str, codex_home: Path) -> Path:
    candidate = Path(selector).expanduser()
    if candidate.suffix.lower() == ".toml" or candidate.parent != Path("."):
        return candidate.resolve()
    return codex_home / f"{selector}.config.toml"


def main() -> int:
    if len(sys.argv) < 3:
        print("usage: codex-profile <profile-name|profile.toml> <codex args...>", file=sys.stderr)
        return 2

    selector, *codex_args = sys.argv[1:]
    codex_home = Path(os.environ.get("CODEX_HOME", Path.home() / ".codex")).expanduser().resolve()
    source = profile_path(selector, codex_home)

    with source.open("rb") as handle:
        profile = tomllib.load(handle)

    codex = shutil.which("codex")
    if not codex:
        raise FileNotFoundError("codex was not found on PATH")

    command = [codex]
    for override in overrides(profile):
        command.extend(("-c", override))
    command.extend(codex_args)
    return subprocess.run(command, check=False).returncode


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as error:
        print(f"codex-profile: {error}", file=sys.stderr)
        raise SystemExit(1)
```

## 2. Tạo launcher CMD

Tạo file `~/.paseo/bin/codex-profile.cmd`:

```bat
@echo off
if /I "%~1"=="--version" (
  codex --version
  exit /b %ERRORLEVEL%
)
python "%~dp0codex-profile.py" %*
exit /b %ERRORLEVEL%
```

Nhánh `--version` giúp Paseo phát hiện đúng phiên bản Codex thay vì phiên bản Python.

## 3. Tạo profile Codex

Ví dụ `~/.codex/root.config.toml`:

```toml
model = "gpt-5.6-sol"
model_reasoning_effort = "medium"

developer_instructions = """
Role: Root.

You are the technical and program lead for the active project.
Use Paseo for delegation and retain architecture, integration, and acceptance authority.
"""

[features]
multi_agent = false

[agents]
enabled = false
```

Ví dụ `~/.codex/supervisor.config.toml`:

```toml
model = "gpt-5.6-luna"
model_reasoning_effort = "max"

developer_instructions = """
Role: Supervisor.

Work independently inside the assigned scope and report verification on handback.
"""

[features]
multi_agent = false

[agents]
enabled = false
```

## 4. Đăng ký provider trong Paseo

Trong `~/.paseo/config.json`, thêm provider dưới `agents.providers`:

```json
{
  "codex-root": {
    "extends": "codex",
    "label": "Codex Root",
    "description": "Lead and integration agent",
    "command": [
      "C:\\Users\\<username>\\.paseo\\bin\\codex-profile.cmd",
      "root"
    ],
    "models": [
      {
        "id": "gpt-5.6-sol",
        "label": "Sol",
        "isDefault": true,
        "thinkingOptions": [
          {
            "id": "medium",
            "label": "Medium",
            "isDefault": true
          }
        ]
      }
    ]
  }
}
```

Không thêm `app-server` vào `command`. Paseo tự nối subcommand này khi khởi động provider.

## 5. Cách launcher hoạt động

Paseo thực hiện:

```powershell
codex-profile.cmd root app-server
```

Launcher đọc `~/.codex/root.config.toml` và chạy tương đương:

```powershell
codex `
  -c 'model="gpt-5.6-sol"' `
  -c 'model_reasoning_effort="medium"' `
  -c 'developer_instructions="Role: Root..."' `
  -c 'features.multi_agent=false' `
  -c 'agents.enabled=false' `
  app-server
```

Codex vẫn dùng `~/.codex` gốc, vì vậy login, MCP, skills, plugins và các cấu hình chung được giữ nguyên.

## 6. Thêm profile mới

Ví dụ thêm role `peer`:

1. Tạo `~/.codex/peer.config.toml`.
2. Thêm provider vào `~/.paseo/config.json`:

```json
{
  "codex-peer": {
    "extends": "codex",
    "label": "Codex Peer",
    "command": [
      "C:\\Users\\<username>\\.paseo\\bin\\codex-profile.cmd",
      "peer"
    ]
  }
}
```

Không cần tạo thêm Python, CMD, runtime hoặc symlink.

Launcher cũng nhận đường dẫn TOML trực tiếp:

```powershell
codex-profile.cmd C:\configs\reviewer.toml app-server
```

## 7. Kiểm tra

Kiểm tra launcher và app-server:

```powershell
~/.paseo/bin/codex-profile.cmd --version
~/.paseo/bin/codex-profile.cmd root app-server --strict-config --help
```

Kiểm tra thông qua Paseo:

```powershell
paseo provider models codex-root --json
paseo provider models codex-supervisor --json
```

Nếu các lệnh trả exit code `0` và danh sách model đúng thì provider đã hoạt động.

## 8. Lưu ý

- Các giá trị trong profile được chuyển thành `-c`, nên có độ ưu tiên cao hơn project config.
- Không dùng đồng thời `--profile` trong command của Paseo.
- Không tự thêm `app-server` vào `config.json`; Paseo làm việc này.
- Profile phải là TOML hợp lệ.
- Launcher không sửa `config.toml` hay các file profile nguồn.

## 9. Xử lý lỗi

### Không tìm thấy profile

```text
codex-profile: [Errno 2] No such file or directory
```

Kiểm tra tên role trong `config.json` có khớp với `<role>.config.toml` hay không.

### Không tìm thấy Codex

```text
codex-profile: codex was not found on PATH
```

Chạy `codex --version` trong PowerShell và sửa `PATH` trước khi khởi động Paseo.

### Python không có `tomllib`

Nâng Python lên phiên bản 3.11 trở lên:

```powershell
python --version
```

### Paseo vẫn báo lỗi `--profile`

Tìm và loại bỏ `--profile` khỏi `agents.providers.<name>.command` trong `~/.paseo/config.json`.
