param(
    [Parameter(Mandatory = $true)][string]$InstallerPath,
    [switch]$Protocols
)
$ErrorActionPreference = 'Stop'
$installer = (Resolve-Path -LiteralPath $InstallerPath).Path
if ([IO.Path]::GetFileName($installer) -notlike 'openscp-*-win-x64-setup.exe') {
    throw 'Select the development NSIS setup package, not a portable executable.'
}
$installed = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
    Where-Object DisplayName -EQ 'OpenSCP'
if ($installed) { throw 'An existing openscp installation must not be overwritten by a smoke test.' }
$workspace = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$installDirectory = Join-Path $workspace ('release\installed-smoke-' + [guid]::NewGuid().ToString('N'))
$previousExecutable = $env:OPENSCP_PACKAGED_EXE
$previousIntegration = $env:OPENSCP_INTEGRATION
try {
    $installation = Start-Process -FilePath $installer -ArgumentList @('/S', "/D=$installDirectory") -WindowStyle Hidden -Wait -PassThru
    if ($installation.ExitCode -ne 0) { throw "Installer failed: $($installation.ExitCode)" }
    $env:OPENSCP_PACKAGED_EXE = Join-Path $installDirectory 'OpenSCP.exe'
    if (-not (Test-Path -LiteralPath $env:OPENSCP_PACKAGED_EXE)) { throw 'Installed executable is missing.' }
    $env:OPENSCP_INTEGRATION = if ($Protocols) { '1' } else { '0' }
    & (Join-Path $workspace 'node_modules\.bin\playwright.cmd') test tests/e2e/packaged-smoke.spec.ts
    if ($LASTEXITCODE -ne 0) { throw 'Installed Windows smoke failed.' }
} finally {
    $env:OPENSCP_PACKAGED_EXE = $previousExecutable
    $env:OPENSCP_INTEGRATION = $previousIntegration
    $uninstaller = Join-Path $installDirectory 'Uninstall OpenSCP.exe'
    if (Test-Path -LiteralPath $uninstaller) {
        $uninstall = Start-Process -FilePath $uninstaller -ArgumentList @('/S', "_?=$installDirectory") -WindowStyle Hidden -Wait -PassThru
        if ($uninstall.ExitCode -ne 0) { throw "Uninstaller failed: $($uninstall.ExitCode)" }
    }
    $validated = [IO.Path]::GetFullPath($installDirectory)
    $allowedRoot = [IO.Path]::GetFullPath((Join-Path $workspace 'release')) + [IO.Path]::DirectorySeparatorChar
    if (-not $validated.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetFileName($validated) -notmatch '^installed-smoke-[a-f0-9]{32}$') { throw 'Unsafe cleanup path.' }
    if (Test-Path -LiteralPath $validated) { Remove-Item -LiteralPath $validated -Recurse -Force }
}
