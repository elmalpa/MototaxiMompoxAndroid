# Estado de la app — 15 de octubre de 2026

Responsable: Carlos Ribon. Soporte: chamoribon@gmail.com.

## Implementado

- Autenticacion HTTP y Socket.IO contra el usuario actual de SQL; revocacion de sesiones al salir, cambiar/restablecer clave o borrar la cuenta.
- Salas privadas asignadas por el servidor, sin aceptar IDs del cliente.
- Asignacion de carreras serializada mediante bloqueos SQL por conductor; aprobacion, telefono verificado y disponibilidad obligatorios.
- Registro de conductores pendiente de revision. El administrador aprueba o suspende tras revisar identidad, documentos y vehiculo fuera de la app.
- Verificacion y recuperacion por SMS: codigos aleatorios de seis digitos, HMAC en SQL, vencimiento de diez minutos, cinco intentos, uso unico y limites por IP.
- Lista disponible sin telefono del cliente, validacion de entradas y errores internos sin detalles SQL al usuario.
- Actualizacion automatica de cliente y conductor con peticiones sin solaparse, pausadas cuando la app no esta activa; avisos de errores y timeout.
- Sesion conservada cuando el servidor no responde, con reintento.
- Seleccion manual de puntos de recogida/destino en mapa y boton de ubicacion actual.
- Ubicacion voluntaria del conductor durante una carrera, con la app abierta; solo el cliente/conductor asignado pueden consultar puntos recientes (menos de un minuto).
- Reportes de soporte asociados opcionalmente a una carrera y bandeja de resolucion del administrador.
- Calificacion unica por viaje y promedio numerico actualizado (bueno=5, regular=3, malo=1).
- Notificaciones por lotes, verificacion de tickets/recibos, limpieza de tokens invalidos y avisos de cambios de estado.
- Privacidad y eliminacion de cuenta con datos reales, servidas por `/legal/`.
- Migracion repetible, readiness que comprueba el esquema y CI para API/exportacion Android.

## Base de datos

La migracion se aplico a la base configurada en `backend/.env`. No borra cuentas ni viajes. Las sesiones anteriores son incompatibles; los conductores existentes quedan pendientes de aprobacion y el telefono debe verificarse.

En cualquier otra base: ejecutar primero `database/schema.sql` o `schema.azure.sql`, y despues `npm run migrate` desde `backend/`. Ejecutar dos veces la migracion es seguro. Hacer copia de seguridad antes de cada despliegue. No desplegar el backend nuevo sobre un esquema anterior.

## Servicios externos por configurar

1. **SMS:** el usuario eligio su Android con SIM Tigo. Ya existe un adaptador para SMSGate (`SMS_PROVIDER=smsgate`) con usuario, contrasena, ID del Android y ranura SIM configurados privadamente en el servidor. Falta instalar/activar la app auxiliar y registrar esas credenciales. Ver [SMS_ANDROID_SETUP.md](SMS_ANDROID_SETUP.md). Sigue disponible el gateway generico anterior con `SMS_PROVIDER=webhook`. Sin configuracion, usuarios sin verificar no pueden solicitar o aceptar carreras.
2. **Google Maps:** habilitar Maps SDK for Android, configurar `GOOGLE_MAPS_API_KEY` en EAS y restringirla al paquete `com.mototaximompox.app` y SHA-1 de firma. Verificar por separado la firma de pruebas y Play App Signing.
3. **Push Android:** agregar `GOOGLE_SERVICES_JSON` como variable de archivo EAS y configurar la credencial FCM v1 en EAS. No guardar archivos de servicio ni claves privadas en Git.
4. **Despliegue:** publicar este codigo del backend y comprobar `/api/ready`, `/legal/privacy-policy.html` y `/legal/account-deletion.html`. La URL de EAS ya figura en `eas.json`, pero eso no demuestra que tenga el codigo nuevo.
5. **Play Console:** generar APK de prueba/AAB, instalar en dos dispositivos, completar ficha y Seguridad de los datos con mapas, SMS y ubicacion opcional; agregar usuarios de revision y completar los requisitos de pruebas que muestre la cuenta.

## Validacion

Resultado de esta sesion: 16 pruebas aprobadas (incluidas dos pruebas de integracion SQL real), sintaxis correcta, exportacion Android/Hermes correcta y migracion aplicada dos veces sin errores. Los datos temporales de las pruebas se eliminaron. No se enviaron SMS reales ni se genero o instalo un APK.

Expo/EAS tiene una sesion con acceso al proyecto. La consulta de nombres de variables de produccion encontro `EXPO_PUBLIC_API_URL`; no encontro `GOOGLE_MAPS_API_KEY` ni `GOOGLE_SERVICES_JSON`. El projectId esta en app.config.js, por lo que no es necesario duplicarlo en una variable EAS.

- `npm test`: pruebas HTTP/Socket y de autorizacion. Las pruebas SQL se omiten salvo `RUN_SQL_TESTS=true`.
- `$env:RUN_SQL_TESTS='true'; npm test`: prueba SQL real de asignacion simultanea, rechazo de ofertas, promedio de calificacion y recuperacion/verificacion con SMS simulados. Crea y elimina solo sus propios datos temporales. Usar preferiblemente una base de pruebas.
- `npm run check`: comprueba todos los JavaScript del backend.
- `npm run export:android`: valida el bundle Hermes; no produce un APK ni verifica permisos, mapas o push en un dispositivo.
- Tras actualizaciones compatibles, npm audit aun informa vulnerabilidades transitivas en herramientas Expo/Metro. No se aplico `--force`, que proponia retroceder a Expo 44. Revisar las alertas antes de publicar y actualizar solo con validacion de compatibilidad.

## Prueba piloto obligatoria

Registrar/verificar cliente y conductor; aprobar conductor; activar disponibilidad; crear viaje con mapa; aceptar y probar contraoferta/rechazo; llamar; compartir y detener ubicacion; cambiar estados; cancelar/finalizar; calificar; crear/resolver reporte; recuperar clave; comprobar revocacion en otro dispositivo y eliminar cuentas sin carreras activas. Repetir con internet intermitente, permiso GPS denegado y notificaciones con la app abierta/cerrada.

La ubicacion no continua en segundo plano. El rastreo solo muestra el ultimo punto reciente, sin ruta calculada ni ETA. Los documentos de conductores se revisan por el responsable; no hay carga ni validacion automatica de documentos.

## Operacion

- Usar HTTPS y SQL cifrado, JWT aleatorio de al menos 32 caracteres y origenes CORS concretos.
- Monitorizar `/api/ready` desde fuera del servidor; alertar por errores de base de datos, SMS y push. No registrar tokens ni direcciones en logs operativos.
- Configurar respaldos automaticos diarios del proveedor SQL y probar restauracion en otra base. Definir retencion y acceso segun la operacion; el repositorio no contrata ni configura respaldos del proveedor.
- El worker del servidor depura desafios SMS y ubicaciones de mas de un dia, y recibos push. Vigilar errores del worker y definir retencion de viajes/reportes antes de operar.
- No hay pagos electronicos ni cobro de comision implementado; la primera version conserva el precio acordado para pago entre participantes.

Referencias de configuracion: [Expo SDK 56](https://docs.expo.dev/versions/v56.0.0/), [ubicacion](https://docs.expo.dev/versions/v56.0.0/sdk/location/), [mapas](https://docs.expo.dev/versions/v56.0.0/sdk/map-view/) y [notificaciones](https://docs.expo.dev/versions/v56.0.0/sdk/notifications/).

Actualizacion SMS Android: 19 pruebas aprobadas y dos pruebas SQL omitidas en la ejecucion rapida. El adaptador fue probado con peticiones simuladas; no se enviaron SMS reales ni se registro un telefono real en SMSGate desde el equipo.

## Configuracion SMS en Render

El usuario ejecuto el configurador privado y su salida confirmo las seis variables SMS guardadas y verificadas. La prueba real desde el backend local llego al destinatario tras conceder permiso SEND_SMS. El sondeo previo al despliegue encontro `/api/health` 200, `/api/ready` 503 y la politica legal 404: el servicio publico aun necesitaba codigo nuevo y resolver su conexion SQL. El Dockerfile nuevo aplica la migracion antes de iniciar.
