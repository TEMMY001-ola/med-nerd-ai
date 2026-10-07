const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get("/", (req, res) => {
  res.status(200).send("MED NERD AI is running!");
});

// Meta WhatsApp Webhook Verification
app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.VERIFY_TOKEN) {
    console.log("Webhook verified successfully");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed");
  return res.sendStatus(403);
});

// Send a WhatsApp text message
async function sendWhatsAppMessage(to, message) {
  const url = `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${process.env.WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: to,
      type: "text",
      text: {
        body: message
      }
    })
  });

  const data = await response.json();

  console.log("WhatsApp API response:", JSON.stringify(data, null, 2));

  if (!response.ok) {
    throw new Error(`WhatsApp API error: ${JSON.stringify(data)}`);
  }

  return data;
}

// WhatsApp incoming messages
app.post("/webhook", async (req, res) => {
  console.log("WhatsApp webhook received:");
  console.log(JSON.stringify(req.body, null, 2));

  // Respond to Meta immediately
  res.sendStatus(200);

  try {
    const message =
      req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

    if (!message) {
      console.log("No incoming WhatsApp message found.");
      return;
    }

    const from = message.from;
    const text = message.text?.body;

    if (!from || !text) {
      console.log("Message has no sender or text.");
      return;
    }

    console.log(`Message from ${from}: ${text}`);

    await sendWhatsAppMessage(
      from,
      "Hello! 👋 MED NERD AI is online. Your message was received successfully."
    );

    console.log("Reply sent successfully.");
  } catch (error) {
    console.error("Failed to send WhatsApp reply:", error);
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`MED NERD AI server running on port ${PORT}`);
});
