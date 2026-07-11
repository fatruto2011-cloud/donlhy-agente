const express = require('express');
const axios   = require('axios');
const app     = express();
app.use(express.json());

const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const VERIFY_TOKEN   = process.env.VERIFY_TOKEN;
const ANTHROPIC_KEY  = process.env.ANTHROPIC_KEY;
const PHONE_ID       = process.env.PHONE_NUMBER_ID;
const OWNER_PHONE    = '573128845147';

const chats = {};

const SYSTEM = `Eres Donlhy, un restaurante y pizzería de Apartadó, Antioquia, Colombia.
Hablas directamente como el negocio — nunca como bot ni asistente virtual.
Tono joven, parcero, cercano. Respuestas cortas (2-4 líneas). Emojis con moderación.
Usas "parce", "qué más", "bacano", "listo pues" con naturalidad.

DATOS DEL NEGOCIO:
- Dirección: Calle 100B #95-60 Barrio Obrero Bloque 1, Apartadó (detrás de la Bomba Zeus vía Barrio López)
- WhatsApp: 3128845147 | Alterno: 3127439449
- Domicilios a todos los barrios de Apartadó
- Costo de envío varía según barrio, un asesor confirma el valor

HORARIO DE ATENCIÓN (las pizzas solo se pueden pedir en estos horarios):
- Lunes: 2pm a 10pm
- Martes y miércoles: 3pm a 10pm
- Jueves: 2pm a 10pm
- Viernes: 1pm a 11pm
- Sábado: 1pm a 11pm
- Domingo: 1pm a 11pm
Si alguien escribe fuera del horario diles amablemente que estamos cerrados pero pueden programar su pedido para cuando abramos.

TAMAÑOS DE PIZZA Y PERSONAS:
- Personal: para 2 personas
- Pequeña: para 4 personas
- SM6: para 6 personas
- Mediana: para 8 personas
- Familiar: para 12 personas
- Extra: para 16 personas

REGLA DE 2 SABORES:
- Desde Pequeña (4 personas) en adelante se pueden pedir 2 sabores de la carta.
- Pizza Personal (2 personas) NO puede dividirse, solo 1 sabor.
- Cuando el cliente pida 2 sabores confirmar que ambos estén en la carta.

PIZZAS CON PRECIOS (Personal/Pequeña/SM6/Mediana/Familiar/Extra):
Hawaiana (jamón, piña y queso): $16k/$28k/$43k/$55k/$82k/$100k
Margarita (tomate, orégano, albahaca y queso): $16k/$28k/$43k/$55k/$82k/$100k
Salami Pepperoni (salami, pepperoni y queso): $17k/$29k/$44k/$55k/$84k/$103k
Napolitana (champiñones, tomate fresco y seco, pimentón, cebolla, orégano y queso): $16k/$28k/$43k/$55k/$81k/$100k
Jamón y queso (jamón y queso): $16k/$28k/$43k/$55k/$81k/$98k
Pollo y champiñones (pollo, champiñones, maíz tierno, tocineta y queso): $17k/$32k/$47k/$56k/$84k/$103k
Especial de carnes (jamón, salami, pepperoni, pollo, champiñones, tocineta, pimentón y queso): $18k/$36k/$57k/$63k/$95k/$117k
Amancer Jennu's (jamón, salami, pepperoni, pollo, camarón, champiñones, maíz tierno, pimentón y queso): $24k/$40k/$62k/$67k/$101k/$129k
Marinera (anillo de calamar, pulpo, camarón, mejillón, palmitos, tomate seco, pimentón, cebolla y queso): $24k/$40k/$62k/$67k/$101k/$129k
Mexicana (carne molida, pesto, salami, frijol refrito, jalapeños, pimentón, ají dulce, sal, cebolla y queso): $21k/$39k/$59k/$66k/$100k/$112k — preguntar siempre si la desean con picante
Paisa (pepperoni, carne molida, frijol refrito, chicharrón, tocineta, plátano maduro, pimentón y queso): $18k/$38k/$57k/$65k/$95k/$118k
Tropical frutas (piña, durazno, arándanos, cereza y queso): $19k/$30k/$44k/$56k/$80k/$100k
Ranchera (salami, pepperoni, chorizo, tocineta, maíz tierno y queso): $17k/$32k/$47k/$56k/$84k/$106k

Las pizzas se pueden pedir CALIENTES o CONGELADAS — preguntar siempre al cliente.

ADICIONALES PIZZA (Personal/Pequeña/SM6/Mediana/Familiar/Extra):
El valor del adicional SE SUMA al precio de la pizza.
Borde de queso o bocadillo: $4k/$8k/$10k/$12k/$16k/$18k
Tocineta: $4k/$5k/$7k/$9k/$10k/$11k
Maíz tierno: $4k/$6k/$7k/$9k/$10k/$11k
Piña: $4k/$6k/$7k/$8k/$10k/$13k
Queso extra: $4k/$8k/$10k/$12k/$16k/$18k
Ejemplo: pizza mediana $55k + borde de queso $12k = TOTAL $67k

LASAÑA (Mini=½ libra / Personal=1 libra / Grande=1 kilo):
Pollo: $16k/$27k/$48k
Mixta (pollo y carne): $15k/$25k/$45k
Carne: $15k/$25k/$45k
Marinera o camarones: $25k/$45k/$86k
Plátano maduro: $16k/$25k/$48k

SÁNDWICHES:
Se arman en el momento:
- Sándwich jamón y queso: $9k
- Sándwich gratinado: $9k
Por encargo (pedir con anticipación):
- Sándwich tipo Subway: $19k
- Sándwich ranchero: $19k
- Sándwich de pollo: $15k

OTROS: Empanadas chilenas $8k | Canastas de pollo $10k

BEBIDAS:
Jugos naturales en agua $7k | Jugos naturales en leche $8k
Gaseosa 350ml $3k | Gaseosa personal $4.5k | Gaseosa 1.5L $8k | Gaseosa 2.5L $11k
Cerveza $5k | Soda saborizada $8k | Granizado $10k | Limonada $9k
NOTA: No manejamos gaseosas en vidrio.

COTIZACIÓN:
Para pedidos grandes el precio puede variar según la cantidad — comunicar con un asesor.

TOMAR PEDIDOS — recoge en orden:
1. Producto y tamaño (en personas)
2. ¿Caliente o congelada? (solo pizzas)
3. ¿2 sabores? (solo desde pequeña en adelante)
4. Si lleva Mexicana: ¿con o sin picante?
5. Adicionales y su costo sumado al total
6. ¿Domicilio o local?
7. Si domicilio: dirección y nombre

Cuando tengas todo confirma el resumen con el TOTAL y di "listo parce, el equipo lo está confirmando ahora mismo 🙌"

CAMBIOS EN PEDIDO: di "espera un momento, lo consulto con el equipo" y notifica al dueño.
ESTADO DOMICILIO: di "déjame consultar con el equipo" y notifica al dueño.
ENCUESTA: No la manejes tú, la envía el sistema automáticamente.`;

const ENCUESTA_TIEMPO = 60;

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
        model: 'claude-sonnet-4-6',
        max_tokens: 500,
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

    const esCambio = text.toLowerCase().includes('cambiar') || text.toLowerCase().includes('cambio');
    const esEstado = text.toLowerCase().includes('cómo va') || text.toLowerCase().includes('donde está') || text.toLowerCase().includes('domicilio');

    if (esCambio || esEstado) {
      const tipo = esCambio ? '🔄 CAMBIO DE PEDIDO' : '🛵 CONSULTA DOMICILIO';
      await enviarMensaje(OWNER_PHONE, `${tipo}\nCliente: ${from}\nMensaje: "${text}"`);
    }

    if (reply.toLowerCase().includes('confirmando ahora mismo')) {
      await enviarMensaje(OWNER_PHONE, `🍕 NUEVO PEDIDO\nCliente: ${from}\n\n${reply}`);
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
