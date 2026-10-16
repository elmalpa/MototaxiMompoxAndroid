param([switch]$DesdePortapapeles)

$ErrorActionPreference = 'Stop'
Write-Host 'Se copiaran solo las seis variables SMS al servicio mototaximompoxandroid.onrender.com.'
Write-Host 'No se enviaran mensajes ni se iniciara un despliegue.'
$renderSecureKey = $null
$renderKeyPointer = [IntPtr]::Zero
$renderPreviousKey = $env:RENDER_API_KEY
try {
    if ($DesdePortapapeles) {
        Write-Host 'Copia AHORA el valor completo de la API Key desde Render.'
        Write-Host 'Vuelve a esta terminal sin pegar la clave. El programa la leera del portapapeles.'
        Read-Host 'Pulsa Enter cuando la hayas copiado' | Out-Null
        $env:RENDER_API_KEY = ([string](Get-Clipboard -Raw)).Trim()
    } else {
        $renderSecureKey = Read-Host 'Render API Key (entrada oculta)' -AsSecureString
        $renderKeyPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($renderSecureKey)
        $env:RENDER_API_KEY = ([Runtime.InteropServices.Marshal]::PtrToStringBSTR($renderKeyPointer)).Trim()
    }
    $env:RENDER_API_KEY = $env:RENDER_API_KEY -replace '^Bearer\s+', ''
    if (-not $env:RENDER_API_KEY) { throw 'No se introdujo una clave.' }
    if ($env:RENDER_API_KEY -match '\s') { throw 'La clave contiene espacios internos. Copia otra vez el valor completo desde Render.' }
    if ($DesdePortapapeles) {
        try {
            Set-Clipboard -Value ' '
            Write-Host 'Clave leida sin mostrarla. Contenido del portapapeles reemplazado.'
        } catch {
            Write-Host 'Clave leida sin mostrarla. No se pudo limpiar el portapapeles; copia otro texto despues.'
        }
    }
    & node (Join-Path $PSScriptRoot 'configure-render-sms.js')
    if ($LASTEXITCODE -ne 0) { Write-Host 'La configuracion no se completo. Revisa el mensaje anterior y vuelve a ejecutar este comando.'; return }
} finally {
    $env:RENDER_API_KEY = $renderPreviousKey
    if ($renderKeyPointer -ne [IntPtr]::Zero) { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($renderKeyPointer) }
    if ($null -ne $renderSecureKey) { $renderSecureKey.Dispose() }
}
