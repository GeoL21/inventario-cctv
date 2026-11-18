"""
Prueba la PWA Inventario CCTV en Chrome con un servidor de Apps Script simulado.

Uso:  python3 .claude/skills/publicar-cctv/probar.py [carpeta del repo]
Revisa: errores de JavaScript, que nada se desborde a lo ancho (320 a 1440 px),
buscar → hoja de vida → mantenimiento sin señal → se sube al volver la señal,
completar un dato y armar el PDF. Deja capturas en /tmp/cctv-prueba/.
"""
import functools, http.server, json, os, socketserver, sys, threading, time

from playwright.sync_api import sync_playwright

RAIZ = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
SALIDA = '/tmp/cctv-prueba'
os.makedirs(SALIDA, exist_ok=True)


class Callado(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


class Servidor(socketserver.TCPServer):
    allow_reuse_address = True


srv = Servidor(('127.0.0.1', 8799), functools.partial(Callado, directory=RAIZ))
threading.Thread(target=srv.serve_forever, daemon=True).start()

ESTADOS = ['Operativa'] * 6 + ['Operativa con novedad', 'Intermitente', 'Fuera de servicio']
REGS = []
for i in range(1, 41):
    sede = 'Barranquilla' if i % 2 else 'Baranoa'
    REGS.append(dict(id='CAM-%04d' % i, fechaRegistro='02/10/2026 10:15', sede=sede, edificacion=sede + ' - Clínica',
                     nivel='Piso %d' % (i % 5 + 1), subzona='A', dependencia='', tipoUbicacion='Pasillo',
                     areaZona='Pasillo %d' % i, referencia='', tipoCamara='Domo', marca='Hikvision', modelo='',
                     serial='S%05d' % i, visionNocturna='Sí', audio='No', estado=ESTADOS[i % 9], estadoFisico='Bueno',
                     estadoCableado='Bueno', ultimoMantenimiento='', proximoMantenimiento='', responsable='',
                     observaciones='Imagen borrosa' if ESTADOS[i % 9] != 'Operativa' else '', fotografia='',
                     registradoPor='Prueba', ip='', nvr='', canal=''))
HIST = []
ACCIONES = []
SIN_SENAL = [False]


def servidor(route):
    if SIN_SENAL[0]:
        return route.abort('internetdisconnected')
    d = json.loads(route.request.post_data or '{}')
    a = d.get('accion')
    ACCIONES.append(a)
    r = {'ok': True}
    if a == 'inventario':
        r.update(registros=REGS, historial=HIST, fecha='17/11/2026 16:40')
    elif a == 'registrar':
        r.update(id='CAM-0041')
    elif a == 'mantenimiento':
        x = d['datos']
        HIST.insert(0, dict(fecha='17/11/2026 17:05', orden=int(time.time() * 1000), idCamara=x['idCamara'],
                            tipo=x['tipo'], actividades=', '.join(x['actividades']), estadoImagen=x['estadoImagen'],
                            huboFalla=x['huboFalla'], falla=x['falla'], repuesto=x['repuesto'],
                            diasFuera=x['diasFuera'], tecnico=x['tecnico'], observaciones=x['observaciones'],
                            tieneFoto=False, uuid=x['uuid']))
    elif a == 'actualizar':
        x = d['datos']
        for g in REGS:
            if g['id'] == x['id']:
                g.update({k: v for k, v in x.items() if k not in ('uuid', 'fechaCaptura', 'fotografia')})
    elif a == 'foto':
        r.update(foto='')
    route.fulfill(status=200, content_type='application/json', body=json.dumps(r))


fallas = []

with sync_playwright() as p:
    nav = p.chromium.launch(executable_path='/usr/bin/google-chrome' if os.path.exists('/usr/bin/google-chrome') else None)

    # 1. Anchos de pantalla
    for ancho in [320, 390, 768, 1024, 1440]:
        ctx = nav.new_context(viewport={'width': ancho, 'height': 860})
        ctx.route('https://script.google.com/**', servidor)
        ctx.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
        pg = ctx.new_page()
        pg.on('pageerror', lambda e, a=ancho: fallas.append('%d px: %s' % (a, e)))
        pg.add_init_script("localStorage.setItem('cctv_codigo','prueba')")
        pg.goto('http://127.0.0.1:8799/')
        pg.wait_for_timeout(1800)
        for vista in ['vResumen', 'vBuscar', 'vRegistrar']:
            pg.click('.nav button[data-vista="%s"]' % vista)
            pg.wait_for_timeout(500)
            w = pg.evaluate('document.documentElement.scrollWidth')
            if w > ancho:
                fallas.append('%d px: %s se desborda (%d px)' % (ancho, vista, w))
            pg.screenshot(path='%s/%d_%s.png' % (SALIDA, ancho, vista))
        ctx.close()

    # 2. Recorrido completo en celular
    ctx = nav.new_context(viewport={'width': 390, 'height': 844}, accept_downloads=True)
    ctx.route('https://script.google.com/**', servidor)
    ctx.route(lambda u: 'fonts.g' in u, lambda r: r.abort())
    pg = ctx.new_page()
    pg.on('pageerror', lambda e: fallas.append('recorrido: %s' % e))
    pg.add_init_script("localStorage.setItem('cctv_codigo','prueba')")
    pg.goto('http://127.0.0.1:8799/')
    pg.wait_for_timeout(1800)
    try:
        pg.click('.nav button[data-vista="vBuscar"]'); pg.wait_for_timeout(600)
        pg.click('button[data-camara="CAM-0003"]'); pg.wait_for_timeout(800)
        SIN_SENAL[0] = True; ctx.set_offline(True)
        pg.click('[data-accion="mtto"]'); pg.wait_for_timeout(300)
        pg.click('button[data-mt="actividad"]'); pg.click('button[data-mt="imagen"][data-valor="Buena"]')
        pg.fill('#mt_tec', 'Prueba'); pg.click('[data-accion="guardarMtto"]'); pg.wait_for_timeout(1500)
        if 'pendiente' not in pg.inner_text('#franjaTexto'):
            fallas.append('sin señal: el mantenimiento no quedó pendiente')
        pg.click('button[data-accion="editarCampo"][data-k="modelo"]'); pg.wait_for_timeout(300)
        pg.fill('#c_modelo', 'DS-PRUEBA'); pg.click('[data-accion="guardarCompletar"]'); pg.wait_for_timeout(1200)
        SIN_SENAL[0] = False; ctx.set_offline(False)
        pg.evaluate("window.dispatchEvent(new Event('online'))"); pg.wait_for_timeout(2500)
        if 'todo subido' not in pg.inner_text('#franjaTexto'):
            fallas.append('al volver la señal no se subió todo: ' + pg.inner_text('#franjaTexto'))
        if 'mantenimiento' not in ACCIONES or 'actualizar' not in ACCIONES:
            fallas.append('el servidor no recibió el mantenimiento o el dato completado')
        pg.evaluate("navigator.canShare = undefined")
        with pg.expect_download(timeout=20000) as dl:
            pg.click('[data-accion="pdf"]')
        dl.value.save_as(SALIDA + '/hoja-de-vida.pdf')
        pg.screenshot(path=SALIDA + '/recorrido.png', full_page=True)
    except Exception as e:
        fallas.append('recorrido: %s' % e)
    nav.close()

srv.shutdown()

if fallas:
    print('FALLÓ:')
    for f in fallas:
        print(' -', f)
    sys.exit(1)

print('TODO BIEN: sin errores, sin desbordes, mantenimiento sin señal, datos completados y PDF. Capturas en ' + SALIDA)
