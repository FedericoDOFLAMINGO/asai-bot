const express = require("express");
const axios = require("axios");
const { GoogleGenerativeAI } = require("@google/generative-ai");

const app = express();
app.use(express.json());

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;

const SYSTEM_PROMPT = `Eres ASKÁN, asesor virtual de ASAI Internacional. Comunica en primera persona con tono amigable y profesional. Respuestas cortas. Responde siempre en el idioma del cliente.

## REGLAS ESTRICTAS
- Máximo UNA confirmación + UNA pregunta por mensaje. Nunca más.
- NUNCA repitas una pregunta ya hecha en la conversación. Avanza siempre al siguiente paso.
- NUNCA menciones precios, costos ni tarifas bajo ninguna circunstancia.
- NUNCA describas diámetros, usos ni características del producto en mensajes de confirmación. Solo confirma y pregunta.
- NUNCA hagas promesas que no puedas cumplir ni ofrezcas asesoría legal.
- Saluda solo si es la primera interacción Y el cliente saluda primero.
- Pide aclaraciones solo si la información es completamente confusa. Una sola vez.
- Menciona certificaciones y garantías únicamente cuando el cliente pregunte por calidad o garantía.

## FLUJO (avanza siempre al siguiente paso sin retroceder)
0. INVENTARIO → "Sí, contamos con [producto]. ¿Para qué aplicación lo necesitas?" / "No contamos con ese producto. ¿Te puedo ayudar con algo más?"
1. RECOMENDACIÓN → "Para esa aplicación te recomiendo [producto]. ¿Quieres más detalles?"
2. DETALLES → "¿Qué prefieres saber: especificaciones técnicas, disponibilidad en stock o garantía?"
3. TRANSFERIR → "Con gusto te conecto con un asesor especializado. ¿Me podrías dar tu nombre?"

## CATÁLOGO
Cuando el cliente pida el catálogo responde exactamente: "Aquí tienes nuestro catálogo: https://drive.google.com/file/d/1CV4GBsKuwY-S4W9z5H4NApl8zzDAd_vb/view?pli=1"

## DESPEDIDA
Solo al cerrar conversación o al transferir: "¡Gracias por contactarnos! Soy ASKÁN, hasta pronto. 👋"

## PRIMER MENSAJE
Tu primer mensaje en cada conversación nueva SIEMPRE debe ser exactamente: "¡Hola! Soy ASKÁN, asesor de ASAI Internacional. ¿En qué te puedo ayudar?"`;

// Historial de conversaciones en memoria
const conversations = {};

async function getGeminiResponse(userPhone, userMessage) {
  const model = genAI.getGenerativeModel({
    model: "gemini-1.5-flash",
    systemInstruction: SYSTEM_PROMPT,
  });

  if (!conversations[userPhone]) {
    conversations[userPhone] = [];
  }

  conversations[userPhone].push({
    role: "user",
    parts: [{ text: userMessage }],
  });

  const chat = model.startChat({
    history: conversations[userPhone].slice(0, -1),
  });

  const result = await chat.sendMessage(userMessage);
  const response = result.response.text();

  conversations[userPhone].push({
    role: "model",
    parts: [{ text: response }],
  });

  // Limpiar historial si es muy largo (más de 20 mensajes)
  if (conversations[userPhone].length > 20) {
    conversations[userPhone] = conversations[userPhone].slice(-20);
  }

  return response;
}

async function sendWhatsAppMessage(to, message) {
  await axios.post(
    `https://graph.facebook.com/v18.0/${PHONE_NUMBER_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: { body: message },
    },
    {
      headers: {
        Authorization: `Bearer ${WHATSAPP_TOKEN}`,
        "Content-Type": "application/json",
      },
    }
  );
}

// Verificación del webhook de Meta
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("Webhook verificado!");
    res.status(200).send(challenge);
  } else {
    res.sendStatus(403);
  }
});

// Recibir mensajes de WhatsApp
app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  const body = req.body;
  if (body.object !== "whatsapp_business_account") return;

  const entry = body.entry?.[0];
  const changes = entry?.changes?.[0];
  const value = changes?.value;
  const messages = value?.messages;

  if (!messages || messages.length === 0) return;

  const message = messages[0];
  if (message.type !== "text") return;

  const userPhone = message.from;
  const userText = message.text.body;

  console.log(`Mensaje de ${userPhone}: ${userText}`);

  try {
    const response = await getGeminiResponse(userPhone, userText);
    await sendWhatsAppMessage(userPhone, response);
    console.log(`Respuesta enviada a ${userPhone}: ${response}`);
  } catch (error) {
    console.error("Error:", error.message);
  }
});

app.get("/", (req, res) => {
  res.send("ASKÁN Bot corriendo ✅");
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor corriendo en puerto ${PORT}`);
});
