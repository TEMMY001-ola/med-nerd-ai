const express = require("express");

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

const VERIFY_TOKEN = process.env.VERIFY_TOKEN;
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GRAPH_API_VERSION = "v26.0";
const GEMINI_MODEL = "gemini-3.8-flash";

// --------------------------------------------------
// BASIC CHECK
// --------------------------------------------------

app.get("/", (req, res) => {
  res.status(200).send("MED_NERD AI is online.");
});

// --------------------------------------------------
// WHATSAPP WEBHOOK VERIFICATION
// --------------------------------------------------

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === VERIFY_TOKEN) {
    console.log("WhatsApp webhook verified.");
    return res.status(200).send(challenge);
  }

  console.log("Webhook verification failed.");
  return res.sendStatus(403);
});

// --------------------------------------------------
// GEMINI REQUEST
// --------------------------------------------------

async function askGemini(userMessage) {
  if (!GEMINI_API_KEY) {
    throw new Error("GEMINI_API_KEY is not configured.");
  }

  const url =
    `https://generativelanguage.googleapis.com/v1beta/models/` +
    `${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(GEMINI_API_KEY)}`;

  const systemInstruction = `
You are MED_NERD AI, an educational AI assistant created for MED_NERD TV.

Your purpose is to help students and aspirants with:
- JAMB/UTME preparation
- Biology
- Chemistry
- Physics
- English
- General academic questions
- University admission guidance
- Study planning
- Medical and health-science educational concepts

Be accurate, clear, educational and concise.

Do not pretend to be a doctor, lecturer, university official, or government official.

For medical or health questions, provide educational information and clearly encourage the user to seek qualified professional care when the situation requires it.

Do not invent admission requirements, university policies, examination scores, or official announcements.

Use simple explanations when teaching difficult concepts, but maintain academic accuracy.

The audience is called MEDNERDITES.
`;

  const body = {
    system_instruction: {
      parts: [
        {
          text: systemInstruction
        }
      ]
    },
    contents: [
      {
        role: "user",
        parts: [
          {
            text: String(userMessage)
          }
        ]
      }
    ],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 1200
    }
  };

  let lastError;

  // Retry temporary Gemini failures.
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });

      const data = await response.json();

      if (!response.ok) {
        const errorMessage =
          data?.error?.message ||
          `Gemini request failed with status ${response.status}`;

        const error = new Error(errorMessage);
        error.status = response.status;

        // Retry temporary server/rate-limit failures.
        if (
          response.status === 429 ||
          response.status === 500 ||
          response.status === 502 ||
          response.status === 503 ||
          response.status === 504
        ) {
          lastError = error;

          if (attempt < 3) {
            const delay = attempt * 2000;
            console.log(
              `Gemini temporary failure (${response.status}). ` +
              `Retrying in ${delay}ms...`
            );

            await new Promise((resolve) =>
              setTimeout(resolve, delay)
            );

            continue;
          }
        }

        throw error;
      }

      const answer =
        data?.candidates?.[0]?.content?.parts
          ?.map((part) => part.text || "")
          .join("")
          .trim();

      if (!answer) {
        throw new Error("Gemini returned an empty response.");
      }

      return answer;
    } catch (error) {
      lastError = error;

      if (attempt < 3 && !error.status) {
        const delay = attempt * 2000;

        console.log(
          `Gemini connection error. Retrying in ${delay}ms...`
        );

        await new Promise((resolve) =>
          setTimeout(resolve, delay)
        );

        continue;
      }

      if (
        attempt < 3 &&
        error.status &&
        ![429, 500, 502, 503, 504].includes(error.status)
      ) {
        throw error;
      }
    }
  }

  throw lastError || new Error("Gemini request failed.");
}

// --------------------------------------------------
// SEND WHATSAPP MESSAGE
// --------------------------------------------------

async function sendWhatsAppMessage(to, message) {
  if (!WHATSAPP_TOKEN) {
    throw new Error("WHATSAPP_TOKEN is not configured.");
  }

  if (!PHONE_NUMBER_ID) {
    throw new Error("PHONE_NUMBER_ID is not configured.");
  }

  const url =
    `https://graph.facebook.com/${GRAPH_API_VERSION}/` +
    `${PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WHATSAPP_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: String(to),
      type: "text",
      text: {
        preview_url: false,
        body: String(message)
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const errorMessage =
      data?.error?.message ||
      `WhatsApp API failed with status ${response.status}`;

    const error = new Error(errorMessage);
    error.status = response.status;
    error.whatsappResponse = data;

    throw error;
  }

  console.log("WhatsApp message sent successfully.");
  return data;
}

// --------------------------------------------------
// WHATSAPP WEBHOOK
// --------------------------------------------------

app.post("/webhook", async (req, res) => {
  // Respond to Meta immediately.
  res.sendStatus(200);

  try {
    const body = req.body;

    console.log(
      "Incoming WhatsApp webhook:",
      JSON.stringify(body)
    );

    if (body.object !== "whatsapp_business_account") {
      return;
    }

    const entries = body.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];

      for (const change of changes) {
        const value = change.value;

        if (!value || !value.messages) {
          continue;
        }

        for (const message of value.messages) {
          if (message.type !== "text") {
            continue;
          }

          const userMessage = message.text?.body?.trim();
          const sender = message.from;

          if (!userMessage || !sender) {
            continue;
          }

          console.log(
            `Message from ${sender}: ${userMessage}`
          );

          let aiResponse;

          try {
            aiResponse = await askGemini(userMessage);
          } catch (geminiError) {
            console.error(
              "Gemini error:",
              geminiError.message
            );

            aiResponse =
              "MED_NERD AI is temporarily experiencing a high " +
              "number of requests. Please send your question again " +
              "in a moment.";
          }

          try {
            await sendWhatsAppMessage(
              sender,
              aiResponse
            );
          } catch (whatsappError) {
            console.error(
              "WhatsApp sending error:",
              whatsappError.message
            );

            if (whatsappError.whatsappResponse) {
              console.error(
                "WhatsApp API response:",
                JSON.stringify(
                  whatsappError.whatsappResponse
                )
              );
            }
          }
        }
      }
    }
  } catch (error) {
    console.error(
      "Webhook processing error:",
      error
    );
  }
});

// --------------------------------------------------
// ERROR HANDLER
// --------------------------------------------------

app.use((err, req, res, next) => {
  console.error("Unhandled application error:", err);

  if (!res.headersSent) {
    res.status(500).json({
      error: "Internal server error"
    });
  }
});

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `MED_NERD AI server running on port ${PORT}`
  );

  console.log(
    `WhatsApp Phone Number ID configured: ${Boolean(
      PHONE_NUMBER_ID
    )}`
  );

  console.log(
    `WhatsApp token configured: ${Boolean(
      WHATSAPP_TOKEN
    )}`
  );

  console.log(
    `Gemini API key configured: ${Boolean(
      GEMINI_API_KEY
    )}`
  );

  console.log(
    `Verify token configured: ${Boolean(
      VERIFY_TOKEN
    )}`
  );
});
