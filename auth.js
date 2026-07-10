// ===== GastosNFC - Autenticacion, hoja personal y resumen por usuario =====
const CLIENT_ID = "142369544324-r9o5p863jqrjm30cf39f0hjib677ru5u.apps.googleusercontent.com";
const SCOPES = "https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.file";
const CATEGORIAS = ["Comida", "Golosinas", "Transporte", "Ocio", "Juegos", "Herramientas", "Compras", "Ropa", "Higiene", "Hogar", "Útiles", "Servicios"];

let tokenClient = null;
let accessToken = null;
let tokenExpiry = 0;

// Se llama una vez que la libreria de Google (gsi/client) esta cargada
function initGoogleAuth(onTokenReady) {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: (resp) => {
      if (resp.error) {
        console.error("Error de login:", resp);
        return;
      }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in * 1000) - 60000;
      localStorage.setItem('gastosnfc_token', accessToken);
      localStorage.setItem('gastosnfc_token_expiry', String(tokenExpiry));
      onTokenReady();
    }
  });

  // Si ya habia sesion en este celular, renueva el token EN SEGUNDO PLANO
  // apenas se carga la pagina, para que guardar un gasto despues sea instantaneo.
  if (hasAccountOnThisDevice()) {
    getValidToken().catch(() => {});
  }
}

// Boton "Iniciar sesion" llama esto
function signIn() {
  tokenClient.requestAccessToken({ prompt: 'consent' });
}

// Cierra sesion en este dispositivo (borra todo lo guardado localmente)
function signOut() {
  localStorage.removeItem('gastosnfc_token');
  localStorage.removeItem('gastosnfc_token_expiry');
  localStorage.removeItem('gastosnfc_sheet_id');
  localStorage.removeItem('gastosnfc_resumen_ready_v3');
  accessToken = null;
  tokenExpiry = 0;
}

// Devuelve un token valido, renovando en silencio si ya expiro
async function getValidToken() {
  const storedExpiry = parseInt(localStorage.getItem('gastosnfc_token_expiry') || '0');

  if (accessToken && Date.now() < tokenExpiry) return accessToken;

  if (Date.now() < storedExpiry) {
    accessToken = localStorage.getItem('gastosnfc_token');
    tokenExpiry = storedExpiry;
    return accessToken;
  }

  return new Promise((resolve, reject) => {
    tokenClient.callback = (resp) => {
      if (resp.error) { reject(resp); return; }
      accessToken = resp.access_token;
      tokenExpiry = Date.now() + (resp.expires_in * 1000) - 60000;
      localStorage.setItem('gastosnfc_token', accessToken);
      localStorage.setItem('gastosnfc_token_expiry', String(tokenExpiry));
      resolve(accessToken);
    };
    tokenClient.requestAccessToken({ prompt: '' });
  });
}

// Si el usuario ya tiene hoja creada en ESTE dispositivo, la reusa.
// Si no, BUSCA en su Drive si ya existe una hoja "GastosNFC" (por si cerro
// sesion y volvio a entrar). Solo si de verdad no existe, la crea con
// las pestañas "Gastos" y "Resumen".
async function getOrCreateSheet() {
  let sheetId = localStorage.getItem('gastosnfc_sheet_id');
  if (sheetId) return sheetId;

  const token = await getValidToken();

  const query = encodeURIComponent(
    "name='GastosNFC' and mimeType='application/vnd.google-apps.spreadsheet' and trashed=false"
  );
  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  const searchData = await searchRes.json();

  if (searchData.files && searchData.files.length > 0) {
    sheetId = searchData.files[0].id;
    localStorage.setItem('gastosnfc_sheet_id', sheetId);
    return sheetId;
  }

  const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      properties: { title: 'GastosNFC' },
      sheets: [
        { properties: { title: 'Gastos' } },
        { properties: { title: 'Resumen' } }
      ]
    })
  });

  const created = await createRes.json();
  if (!created.spreadsheetId) {
    throw new Error('No se pudo crear la hoja: ' + JSON.stringify(created));
  }
  sheetId = created.spreadsheetId;

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Gastos!A1:E1?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [["Fecha", "Hora", "Monto", "Categoria", "Mes"]] })
    }
  );

  await escribirFormulasResumen(sheetId, token);
  localStorage.setItem('gastosnfc_sheet_id', sheetId);
  localStorage.setItem('gastosnfc_resumen_ready_v3', '1');
  return sheetId;
}

// Escribe (o vuelve a escribir) las formulas de la pestaña Resumen
async function escribirFormulasResumen(sheetId, token) {
  const filasCategoria = CATEGORIAS.map((cat, i) => {
    const fila = 6 + i;
    return [
      cat,
      `=SUMIFS(Gastos!C:C,Gastos!D:D,"${cat}",Gastos!E:E,TEXT(TODAY(),"YYYY-MM"))`
    ];
  });
  const ultimaFilaCat = 5 + CATEGORIAS.length;

  const values = [
    ["RESUMEN DE GASTOS", ""],
    ["", ""],
    ["Mes actual:", "=TEXT(TODAY(),\"mmmm yyyy\")"],
    ["", ""],
    ["Categoría", "Total del mes (S/)"],
    ...filasCategoria,
    ["", ""],
    ["TOTAL DEL MES", `=SUM(B6:B${ultimaFilaCat})`],
    ["TOTAL GENERAL (todo el historial)", "=SUM(Gastos!C:C)"]
  ];

  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Resumen!A1:B${values.length}?valueInputOption=USER_ENTERED`,
    {
      method: 'PUT',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values })
    }
  );
}

// Se asegura de que la pestaña "Resumen" exista (para hojas creadas antes
// de esta actualizacion). Solo revisa una vez por sesion en este dispositivo.
async function asegurarResumen() {
  if (localStorage.getItem('gastosnfc_resumen_ready_v3')) return;

  const token = await getValidToken();
  const sheetId = await getOrCreateSheet();

  const infoRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties.title`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  const info = await infoRes.json();
  const tieneResumen = (info.sheets || []).some(s => s.properties.title === 'Resumen');

  if (!tieneResumen) {
    await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests: [{ addSheet: { properties: { title: 'Resumen' } } }] })
    });
  }

  await escribirFormulasResumen(sheetId, token);
  localStorage.setItem('gastosnfc_resumen_ready_v3', '1');
}

// Guarda un gasto en LA HOJA DEL USUARIO QUE INICIO SESION EN ESTE CELULAR
async function appendGasto(monto, categoria) {
  const token = await getValidToken();
  const sheetId = await getOrCreateSheet();

  const ahora = new Date();
  const fecha = ahora.toLocaleDateString('es-PE'); // 05/07/2026
  const hora = ahora.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' });
  const mes = ahora.toISOString().slice(0, 7); // 2026-07

  const res = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Gastos!A:E:append?valueInputOption=USER_ENTERED`,
    {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values: [[fecha, hora, monto, categoria, mes]] })
    }
  );

  if (!res.ok) {
    const err = await res.json();
    throw new Error('Error al guardar: ' + JSON.stringify(err));
  }
  return res.json();
}

// Devuelve la URL directa a la hoja del usuario, para el boton "Ver resumen"
function urlHojaUsuario() {
  const sheetId = localStorage.getItem('gastosnfc_sheet_id');
  if (!sheetId) return null;
  return `https://docs.google.com/spreadsheets/d/${sheetId}/edit#gid=0`;
}

function hasAccountOnThisDevice() {
  return !!localStorage.getItem('gastosnfc_sheet_id') && !!localStorage.getItem('gastosnfc_token');
}
