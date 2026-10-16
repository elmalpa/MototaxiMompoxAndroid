# SMS desde el Android con SIM Tigo

El servidor ya admite SMS Gateway for Android (SMSGate). Es una aplicacion auxiliar que solo se instala en el telefono que envia los codigos, no en los telefonos de clientes/conductores. La app de mototaxi no recibe permisos para enviar ni leer SMS.

## En el telefono

1. Instalar la version estandar desde la [pagina oficial de instalacion](https://docs.sms-gate.app/installation/), siguiendo el enlace a sus releases oficiales. Si Android bloquea la instalacion, revisar el aviso antes de continuar; no es necesario desactivar protecciones como parte de este procedimiento.
2. Permitir enviar SMS. Si hay varias SIM, configurar la SIM Tigo para el envio; puede ser necesario permiso de estado del telefono para seleccionarla. No necesitamos activar lectura de mensajes ni webhooks de mensajes recibidos.
3. Activar **Cloud Server** y pulsar **Offline** para pasar a **Online**. La app genera usuario y contrasena. Obtener tambien el identificador del dispositivo desde la app o su panel de dispositivos.
4. Mantener el telefono con internet, senal movil y capacidad de enviar SMS. Revisar en los ajustes Android que la gestion de bateria no cierre esta app. Los SMS salen desde la SIM elegida y consumen los recursos de esa linea; confirmar con Tigo que el plan permite el uso previsto.

El modo cloud evita abrir puertos del telefono. El servicio intermediario procesa el destinatario y el contenido del codigo; debe tenerse en cuenta en la privacidad. La aceptacion de una solicitud por la API no garantiza que el SMS llegue.

## Configuracion privada del backend

Desde PowerShell, situado en la carpeta del proyecto, ejecutar `./backend/scripts/configure-smsgate.ps1`. Solicita usuario, Device ID, ranura y contrasena con entrada oculta. Conserva los otros valores de `backend/.env` y no envia SMS. Solo configura el servidor local; Render requiere las mismas variables en su panel privado.

En `backend/.env` local, o en las variables privadas del servidor que atiende la app:

```dotenv
SMS_PROVIDER=smsgate
SMSGATE_URL=https://api.sms-gate.app/3rdparty/v1
SMSGATE_USERNAME=usuario_generado_en_el_movil
SMSGATE_PASSWORD=contrasena_generada_en_el_movil
SMSGATE_DEVICE_ID=identificador_de_ese_android
SMSGATE_SIM_NUMBER=1
```

Cambiar SIM_NUMBER a 2 si Tigo esta en la segunda ranura. Configurar todos los campos antes de reiniciar el servidor. No poner estas credenciales en Expo, EAS_PUBLIC, Git ni el chat.

La configuracion local ya se guardo privadamente y se comprobo el acceso al Android. La prueba real fue recibida despues de habilitar el permiso SMS. El proveedor anterior por webhook sigue disponible si SMS_PROVIDER=webhook.

## Copiar la configuracion a Render

Con SMSGate ya configurado localmente, ejecutar `./backend/scripts/configure-render-sms.ps1` desde la raiz del proyecto. Solicita una Render API Key con entrada oculta y la conserva solo durante el proceso. Se obtiene en [Account Settings de Render](https://dashboard.render.com/u/settings), seccion API Keys. No pegar esa clave en el chat.

El script busca el servicio cuya URL coincide exactamente con `https://mototaximompoxandroid.onrender.com`, actualiza y verifica solamente las seis variables SMS, sin copiar SQL/JWT ni sustituir el resto del entorno. No envia SMS ni inicia despliegues. Si falla parcialmente, informa las claves guardadas y puede repetirse. Despues hay que desplegar el backend actualizado.

Si la terminal no permite pegar en la entrada oculta, ejecutar `./backend/scripts/configure-render-sms.ps1 -DesdePortapapeles`. Cuando el programa lo indique, copiar la clave desde Render, volver a la terminal y pulsar Enter sin pegarla. El script la lee sin mostrarla y vacia el portapapeles. No ejecutar este modo desde un transcript que registre valores de variables.

## Verificacion

Registrar una cuenta con un movil colombiano y usar **Verificar mi telefono**. El adaptador convierte numeros de diez digitos que empiezan por 3 a +57, fija el Android y SIM elegidos y limita la cola del mensaje a diez minutos. Los desafios conservan sus limites de vencimiento e intentos en SQL. Si se solicita otro codigo despues de expirar, usar el nuevo.

Comprobar primero un unico destinatario controlado. Revisar el estado en SMSGate y comprobar la recepcion en ese destinatario. No enviar pruebas masivas. No hay reintentos automaticos del adaptador para evitar duplicar un SMS cuando la respuesta se pierde.

Pruebas automatizadas: `npm test` desde backend. Las pruebas del adaptador simulan la API y no envian SMS reales.

Referencias: [modo Cloud Server](https://docs.sms-gate.app/getting-started/public-cloud-server/), [formato de mensajes](https://docs.sms-gate.app/features/sending-messages/).
