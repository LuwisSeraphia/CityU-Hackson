import json
import os
from pathlib import Path
import subprocess
import sys

import pytest


def test_powershell_scripts_have_bom_for_windows_powershell_51():
    root = Path(__file__).resolve().parents[3]
    for script in (root / "scripts").glob("*.ps1"):
        data = script.read_bytes()
        if not data.isascii():
            assert data.startswith(b"\xef\xbb\xbf"), script.name
        data.decode("utf-8-sig")


@pytest.mark.skipif(sys.platform != "win32", reason="Windows PowerShell regression")
def test_windows_powershell_parses_all_startup_scripts():
    root = Path(__file__).resolve().parents[3]
    powershell = Path(os.environ["SystemRoot"]) / "System32/WindowsPowerShell/v1.0/powershell.exe"
    # Parse only: do not start services, read local credentials or run cloud checks.
    command = """
$failures = @()
Get-ChildItem -LiteralPath scripts -Filter '*.ps1' | ForEach-Object {
    $tokens = $null
    $parseErrors = $null
    [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$parseErrors)
    if ($parseErrors.Count -gt 0) { $failures += $_.Name }
}
ConvertTo-Json -Compress -InputObject @{ failures = $failures; version = $PSVersionTable.PSVersion.Major }
if ($failures.Count -gt 0) { exit 1 }
"""
    result = subprocess.run(
        [str(powershell), "-NoProfile", "-NonInteractive", "-Command", command],
        cwd=root,
        capture_output=True,
        text=True,
        timeout=30,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    report = json.loads(result.stdout)
    assert report["version"] == 5
    assert report["failures"] == []
