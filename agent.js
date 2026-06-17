const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const PHONE_ID       = process.env.PHONE_NUMBER_ID;
const OWNER_PHONE    = '573128845147'; // Tu número

const chats = {};
const pedidosPendientes = {};

const SYSTEM = `Eres Donlhy, un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Hablas directamente como el negocio — nunca como bot ni asistente virtual.
Tono joven, parcero, cercano. Respuestas cortas (2-4 líneas). Emojis con moderación.
Usas "parce", "qué más", "bacano", "listo pues" con naturalidad.

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147 | Alterno: 3127439449
- Domicilios a todos los barrios de Apartadó
- Costo de envío varía según barrio, un asesor confirma el valor

HORARIO: Por definir — si preguntan por horario di "en seguida te confirmo el horario"

PIZZAS (Personal 2p / Pequeña 4p / SM6 6p / Mediana 8p / Familiar 12p / Extra 16p):
Hawaiana (jamón, piña, queso): 16k/28k/43k/55k/82k/100k
Margarita (tomate, orégano, albahaca, queso): 16k/28k/43k/55k/82k/100k
Salami Pepperoni: 17k/29k/44k/55k/84k/103k
Napolitana (champiñones, tomate, pimentón, cebolla): 16k/28k/43k/55k/81k/100k
Jamón y queso: 16k/28k/43k/55k/81k/98k
Pollo y champiñones (maíz tierno, tocineta): 17k/32k/47k/56k/84k/103k
Especial de carnes: 18k/36k/57k/63k/95k/117k
Amancer Jennu's (mar y tierra): 24k/40k/62k/67k/101k/129k
Marinera (mariscos): 24k/40k/62k/67k/101k/129k
Mexicana (desmechada, jalapeños): 21k/39k/59k/66k/100k/112k
Paisa (desmechada, chicharrón, plátano): 18k/38k/57k/65k/95k/118k
Tropical frutas (piña, durazno, arándanos): 19k/30k/44k/56k/80k/100k
Ranchera (salami, chorizo, tocineta): 17k/32k/47k/56k/84k/106k

LASAÑA (Mini=½ lb / Personal=Libra / Grande=Kilo):
Pollo 16k/27k/48k | Mixta 15k/25k/45k | Carne 15k/25k/45k
Marinera 25k/45k/86k | Plátano maduro 16k/25k/48k

ADICIONALES PIZZA: Borde queso/bocadillo, tocineta, maíz, piña, queso extra (desde 4k)
SANDWICHS: Subway 19k | Jamón y queso 9k | Pollo 15k | Ranchero 19k
OTROS: Empanadas chilenas 8k | Canastas de pollo 10k
BEBIDAS: Jugo agua 7k | Jugo leche 8k | Gaseosa 350ml 3k | Gaseosa P 4.5k | 1.5L 8k | 2.5L 11k | Cerveza 5k | Soda 8k | Granizado 10k | Limonada 9k

TOMAR PEDIDOS — recoge en orden:
1. Producto y tamaño
2. Adicionales
3. ¿Domicilio o local?
4. Si domicilio: dirección y nombre

Cuando el pedido esté completo, confirma el resumen y di "listo parce, el equipo lo está confirmando ahora mismo 🙌"

CAMBIOS EN PEDIDO: Si el cliente pide un cambio di "espera un momento, lo consulto con el equipo" y notifica.
ESTADO DOMICILIO: Si preguntan cómo va di "déjame consultar con el equipo" y notifica.
ENCUESTA: No la manejes tú, la envía el sistema automáticamente.`;

const ENCUESTA_TIEMPO = 60; // minutos — cambia este número para ajustar

async function enviarMensaje(telefono, mensaje) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_ID}/messages`,
    {
      messaging_product: 'whatsapp',
      to: telefono,
      type: 'text',
      text: { body: mensaje },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        'Content-Type': 'application/json',
      },
    }
  );
}

app.get('/webhook', (req, res) => {
  if (req.query['hub.verify_token'] === VERIFY_TOKEN) {
    res.send(req.query['hub.challenge']);
  } else {
    res.sendStatus(403);
  }
});

app.post('/webhook', async (req, res) => {
  res.sendStatus(200);
  try {
    const msg = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
    if (!msg || msg.type !== 'text') return;

    const from = msg.from;
    const text = msg.text.body;

    if (!chats[from]) chats[from] = [];
    chats[from].push({ role: 'user', content: text });
    if (chats[from].length > 12)
      chats[from] = chats[from].slice(-12);

    const { data } = await axios.post(
      'https://api.anthropic.com/v1/messages',
      {
        model: 'claude-sonnet-4-20250514',
        max_tokens: 450,
        system: SYSTEM,
        messages: chats[from],
      },
      {
        headers: {
          'x-api-key': ANTHROPIC_KEY,
          'anthropic-version': '2023-06-01',
          'Content-Type': 'application/json',
        },
      }
    );

    const reply = data.content[0].text;
    chats[from].push({ role: 'assistant', content: reply });

    await enviarMensaje(from, reply);

    // Notificar al dueño si hay cambio o consulta de estado
    const esCambio = text.toLowerCase().includes('cambiar') || text.toLowerCase().includes('cambio');
    const esEstado = text.toLowerCase().includes('cómo va') || text.toLowerCase().includes('donde está') || text.toLowerCase().includes('domicilio');

    if (esCambio || esEstado) {
      const tipo = esCambio ? '🔄 CAMBIO DE PEDIDO' : '🛵 CONSULTA DOMICILIO';
      await enviarMensaje(OWNER_PHONE, `${tipo}\nCliente: ${from}\nMensaje: "${text}"`);
    }

    // Detectar pedido confirmado y programar encuesta
    if (reply.toLowerCase().includes('confirmando ahora mismo')) {
      const resumen = reply;
      await enviarMensaje(OWNER_PHONE, `🍕 NUEVO PEDIDO\nCliente: ${from}\n\n${resumen}`);

      // Encuesta después de X minutos
      setTimeout(async () => {
        await enviarMensaje(from,
          '¡Ey! Esperamos que hayas disfrutado tu pedido de Donlhy 🍕\n\n' +
          '¿Cómo calificarías tu experiencia?\n' +
          '⭐ 1 - Muy malo\n⭐⭐ 2 - Malo\n⭐⭐⭐ 3 - Regular\n⭐⭐⭐⭐ 4 - Bueno\n⭐⭐⭐⭐⭐ 5 - Excelente\n\n' +
          'Responde con el número 🙏'
        );
      }, ENCUESTA_TIEMPO * 60 * 1000);
    }

  } catch (err) {
    console.error('Error agente Donlhy:', err.message);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () =>
  console.log(`🍕 Agente Donlhy corriendo en puerto ${PORT}`)
);
