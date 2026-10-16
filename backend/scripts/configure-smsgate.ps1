$ErrorActionPreference = 'Stop'
$smsEnvPath = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../.env'))
if (-not (Test-Path -LiteralPath $smsEnvPath)) {
    throw 'Primero crea backend/.env siguiendo README.md. Este configurador conserva la conexion SQL existente.'
}

Write-Host 'Configuracion local de SMSGate. No envia SMS ni muestra la contrasena.'
Write-Host 'Usa credenciales nuevas si la contrasena aparecio en una captura compartida.'
$smsUsername = (Read-Host 'Cloud server - Username').Trim()
$smsDeviceId = (Read-Host 'Cloud server - Device ID').Trim()
$smsSim = (Read-Host 'Ranura de la SIM Tigo (1 o 2)').Trim()
$smsSecurePassword = Read-Host 'Cloud server - Password (entrada oculta)' -AsSecureString
$smsPasswordPointer = [IntPtr]::Zero
try {
    $smsPasswordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($smsSecurePassword)
    $smsPassword = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($smsPasswordPointer)
    if (-not $smsUsername -or -not $smsDeviceId -or -not $smsPassword -or $smsSim -notmatch '^[12]$') {
        throw 'Completa todos los campos y selecciona la ranura 1 o 2.'
    }
    foreach ($smsValue in @($smsUsername, $smsDeviceId, $smsPassword)) {
        if ($smsValue.Contains("'") -or $smsValue.Contains("`r") -or $smsValue.Contains("`n")) {
            throw 'Una credencial contiene caracteres no admitidos por este configurador. No se guardaron cambios.'
        }
    }
    if ($smsUsername.Contains(':')) { throw 'El usuario no debe contener dos puntos.' }
    $smsUpdates = [ordered]@{
        SMS_PROVIDER = 'smsgate'
        SMSGATE_URL = 'https://api.sms-gate.app/3rdparty/v1'
        SMSGATE_USERNAME = $smsUsername
        SMSGATE_PASSWORD = $smsPassword
        SMSGATE_DEVICE_ID = $smsDeviceId
        SMSGATE_SIM_NUMBER = $smsSim
    }
    $smsExistingLines = [IO.File]::ReadAllLines($smsEnvPath)
    $smsKeptLines = @($smsExistingLines | Where-Object {
        $_ -notmatch '^\s*(?:export\s+)?(?:SMS_PROVIDER|SMSGATE_URL|SMSGATE_USERNAME|SMSGATE_PASSWORD|SMSGATE_DEVICE_ID|SMSGATE_SIM_NUMBER)\s*='
    })
    $smsNewLines = @($smsKeptLines) + @('')
    foreach ($smsEntry in $smsUpdates.GetEnumerator()) {
        $smsNewLines += ($smsEntry.Key + "='" + $smsEntry.Value + "'")
    }
    [IO.File]::WriteAllLines($smsEnvPath, [string[]]$smsNewLines, (New-Object Text.UTF8Encoding($false)))
    Write-Host 'Guardado en backend/.env. No se enviaron mensajes. Reinicia el backend para aplicar los cambios.'
    Write-Host 'Si usas Render, configura tambien estas variables en su panel privado; este cambio solo es local.'
} finally {
    if ($smsPasswordPointer -ne [IntPtr]::Zero) {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($smsPasswordPointer)
    }
    $smsPassword = $null
    $smsUpdates = $null
    $smsNewLines = $null
    $smsSecurePassword.Dispose()
}
