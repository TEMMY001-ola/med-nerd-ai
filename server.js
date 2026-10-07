const express = require("express");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: "1mb" }));


// ============================================================
// CONFIGURATION
// ============================================================

// Gemini model
const GEMINI_MODEL = "gemini-3.8-flash";

const GEMINI_URL =
  `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

const MAX_GEMINI_ATTEMPTS = 4;

const MAX_USER_MESSAGE_LENGTH = 4000;

const MAX_AI_RESPONSE_LENGTH = 4000;

const MAX_HISTORY_MESSAGES = 8;

const USER_RATE_LIMIT_MS = 5000;

const GEMINI_TIMEOUT_MS = 30000;


// ============================================================
// SIMPLE IN-MEMORY STORAGE
// ============================================================

const processedMessages = new Map();

const conversations = new Map();

const lastUserMessageTime = new Map();


// ============================================================
// HOME
// ============================================================

app.get("/", (req, res) => {
  res.status(200).send("MED NERD AI is running!");
});


// ============================================================
// HEALTH CHECK
// ============================================================

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "MED NERD AI"
  });
});


// ============================================================
// META WEBHOOK VERIFICATION
// ============================================================

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (
    mode === "subscribe" &&
    token === process.env.VERIFY_TOKEN
  ) {
    console.log("Webhook verified successfully");

    return res
      .status(200)
      .send(challenge);
  }

  console.log("Webhook verification failed");

  return res.sendStatus(403);
});


// ============================================================
// SEND WHATSAPP MESSAGE
// ============================================================

async function sendWhatsAppMessage(to, message) {

  if (!process.env.PHONE_NUMBER_ID) {
    throw new Error(
      "PHONE_NUMBER_ID is not configured."
    );
  }

  if (!process.env.WHATSAPP_TOKEN) {
    throw new Error(
      "WHATSAPP_TOKEN is not configured."
    );
  }

  console.log(
    "Attempting WhatsApp message to recipient:",
    to
  );

  console.log(
    "Using WhatsApp Phone Number ID:",
    process.env.PHONE_NUMBER_ID
  );

  const url =
    `https://graph.facebook.com/v26.0/${process.env.PHONE_NUMBER_ID}/messages`;

  const controller =
    new AbortController();

  const timeout =
    setTimeout(() => {
      controller.abort();
    }, 30000);

  try {

    const response =
      await fetch(
        url,
        {
          method: "POST",

          headers: {
            "Authorization":
              `Bearer ${process.env.WHATSAPP_TOKEN}`,

            "Content-Type":
              "application/json"
          },

          body: JSON.stringify({
            messaging_product: "whatsapp",

            to: String(to),

            type: "text",

            text: {
              body: String(message)
            }
          }),

          signal: controller.signal
        }
      );

    const data =
      await response.json();

    console.log(
      "WhatsApp API response:",
      JSON.stringify(
        data,
        null,
        2
      )
    );

    if (!response.ok) {

      throw new Error(
        `WhatsApp API error: ${JSON.stringify(data)}`
      );
    }

    console.log(
      "WhatsApp message sent successfully to:",
      to
    );

    return data;

  } finally {

    clearTimeout(timeout);

  }
}


// ============================================================
// SLEEP
// ============================================================

function sleep(ms) {
  return new Promise(
    resolve => setTimeout(resolve, ms)
  );
}


// ============================================================
// RANDOM JITTER
// ============================================================

function randomJitter(maxMs = 1000) {
  return Math.floor(
    Math.random() * maxMs
  );
}


// ============================================================
// GEMINI REQUEST WITH RETRIES
// ============================================================

async function askGemini(
  userMessage,
  history
) {

  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }


  for (
    let attempt = 1;
    attempt <= MAX_GEMINI_ATTEMPTS;
    attempt++
  ) {

    const controller =
      new AbortController();

    const timeout =
      setTimeout(() => {
        controller.abort();
      }, GEMINI_TIMEOUT_MS);


    try {

      console.log(
        `Gemini request attempt ${attempt}/${MAX_GEMINI_ATTEMPTS}`
      );


      const contents = [];


      // --------------------------------------------------------
      // CONVERSATION HISTORY
      // --------------------------------------------------------

      for (const item of history) {

        contents.push({
          role: item.role,

          parts: [
            {
              text: item.text
            }
          ]
        });

      }


      // --------------------------------------------------------
      // CURRENT USER MESSAGE
      // --------------------------------------------------------

      contents.push({
        role: "user",

        parts: [
          {
            text: userMessage
          }
        ]
      });


      // --------------------------------------------------------
      // GEMINI REQUEST
      // --------------------------------------------------------

      const response =
        await fetch(
          GEMINI_URL,
          {
            method: "POST",

            headers: {
              "Content-Type":
                "application/json",

              "x-goog-api-key":
                process.env.GEMINI_API_KEY
            },

            body: JSON.stringify({

              system_instruction: {
                parts: [
                  {
                    text: `
You are MED NERD AI, an educational AI assistant created by MED NERD.

Your primary audience is students and aspiring university students.

Your job is to provide clear, accurate and useful educational assistance.

GENERAL RULES:
- Answer the user's actual question directly.
- Explain concepts clearly.
- Teach rather than merely provide answers.
- Use examples when helpful.
- Keep answers reasonably concise for WhatsApp.
- Use simple WhatsApp-friendly formatting.
- Do not claim to be human.
- Do not claim to be a doctor or medical professional.

MEDICAL AND HEALTH QUESTIONS:
- Provide educational information.
- Do not pretend to diagnose the user.
- Do not present uncertain information as certain.
- For emergencies, severe symptoms, diagnosis or treatment decisions, advise the user to seek appropriate professional medical care.
- Do not replace a qualified healthcare professional.

ACADEMIC QUESTIONS:
- Explain the underlying concept.
- Where appropriate, show steps.
- Help the student understand how to solve similar questions independently.

MED NERD AI should be professional, helpful, respectful and student-friendly.
                    `
                  }
                ]
              },

              contents: contents,

              generationConfig: {
                maxOutputTokens: 1000
              }

            }),

            signal: controller.signal
          }
        );


      const data =
        await response.json();


      console.log(
        "Gemini API response:",
        JSON.stringify(
          data,
          null,
          2
        )
      );


      // --------------------------------------------------------
      // SUCCESS
      // --------------------------------------------------------

      if (response.ok) {

        const answer =
          data.candidates?.[0]?.content?.parts
            ?.map(
              part => part.text || ""
            )
            .join("")
            .trim();


        if (!answer) {

          throw new Error(
            "Gemini returned no text answer."
          );

        }


        console.log(
          "Gemini generated a successful answer."
        );


        return answer.slice(
          0,
          MAX_AI_RESPONSE_LENGTH
        );

      }


      // --------------------------------------------------------
      // RETRYABLE ERRORS
      // --------------------------------------------------------

      const retryableStatusCodes = [
        408,
        429,
        500,
        502,
        503,
        504
      ];


      if (
        retryableStatusCodes.includes(
          response.status
        ) &&
        attempt < MAX_GEMINI_ATTEMPTS
      ) {

        const baseDelay =
          Math.pow(2, attempt) * 1000;

        const jitter =
          randomJitter(1000);

        const delay =
          baseDelay + jitter;


        console.log(
          `Gemini returned ${response.status}. ` +
          `Retrying in ${delay}ms.`
        );


        await sleep(delay);

        continue;

      }


      throw new Error(
        `Gemini API error ${response.status}: ` +
        JSON.stringify(data)
      );


    } catch (error) {

      const isTimeout =
        error.name === "AbortError";


      console.error(
        `Gemini attempt ${attempt} failed:`,
        error.message
      );


      if (
        attempt < MAX_GEMINI_ATTEMPTS
      ) {

        const baseDelay =
          Math.pow(2, attempt) * 1000;

        const jitter =
          randomJitter(1000);

        const delay =
          baseDelay + jitter;


        console.log(
          `${isTimeout ? "Gemini timeout" : "Gemini network error"}. ` +
          `Retrying in ${delay}ms.`
        );


        await sleep(delay);

        continue;

      }


      throw error;


    } finally {

      clearTimeout(timeout);

    }

  }


  throw new Error(
    "Gemini failed after all retry attempts."
  );
}


// ============================================================
// GET USER CONVERSATION
// ============================================================

function getConversation(userId) {

  if (!conversations.has(userId)) {

    conversations.set(
      userId,
      []
    );

  }

  return conversations.get(userId);
}


// ============================================================
// SAVE CONVERSATION
// ============================================================

function saveConversation(
  userId,
  role,
  text
) {

  const history =
    getConversation(userId);


  history.push({
    role: role,
    text: text
  });


  while (
    history.length >
    MAX_HISTORY_MESSAGES
  ) {

    history.shift();

  }
}


// ============================================================
// DUPLICATE MESSAGE PROTECTION
// ============================================================

function isDuplicateMessage(messageId) {

  if (!messageId) {
    return false;
  }


  if (
    processedMessages.has(
      messageId
    )
  ) {

    return true;

  }


  processedMessages.set(
    messageId,
    Date.now()
  );


  return false;
}


// ============================================================
// RATE LIMIT USER
// ============================================================

function isRateLimited(userId) {

  const now =
    Date.now();

  const last =
    lastUserMessageTime.get(
      userId
    );


  if (
    last &&
    now - last <
    USER_RATE_LIMIT_MS
  ) {

    return true;

  }


  lastUserMessageTime.set(
    userId,
    now
  );


  return false;
}


// ============================================================
// CLEAN OLD MEMORY
// ============================================================

setInterval(() => {

  const now =
    Date.now();


  for (
    const [
      id,
      timestamp
    ]
    of processedMessages
  ) {

    if (
      now - timestamp >
      60 * 60 * 1000
    ) {

      processedMessages.delete(id);

    }

  }


  for (
    const [
      userId,
      timestamp
    ]
    of lastUserMessageTime
  ) {

    if (
      now - timestamp >
      60 * 60 * 1000
    ) {

      lastUserMessageTime.delete(
        userId
      );

    }

  }

}, 10 * 60 * 1000);


// ============================================================
// WHATSAPP INCOMING MESSAGES
// ============================================================

app.post(
  "/webhook",
  async (req, res) => {

    console.log(
      "WhatsApp webhook received:"
    );


    console.log(
      JSON.stringify(
        req.body,
        null,
        2
      )
    );


    // --------------------------------------------------------
    // RESPOND TO META IMMEDIATELY
    // --------------------------------------------------------

    res.sendStatus(200);


    try {

      const message =
        req.body
          ?.entry?.[0]
          ?.changes?.[0]
          ?.value
          ?.messages?.[0];


      if (!message) {

        console.log(
          "No incoming WhatsApp message found."
        );

        return;

      }


      const messageId =
        message.id;


      const from =
        message.from;


      const text =
        message.text?.body;


      // --------------------------------------------------------
      // IMPORTANT RECIPIENT DIAGNOSTICS
      // --------------------------------------------------------

      console.log(
        "WhatsApp sender number:",
        from
      );

      console.log(
        "Configured WhatsApp Phone Number ID:",
        process.env.PHONE_NUMBER_ID
      );


      // --------------------------------------------------------
      // DUPLICATE PROTECTION
      // --------------------------------------------------------

      if (
        isDuplicateMessage(
          messageId
        )
      ) {

        console.log(
          `Duplicate message ignored: ${messageId}`
        );

        return;

      }


      // --------------------------------------------------------
      // VALIDATE MESSAGE
      // --------------------------------------------------------

      if (!from || !text) {

        console.log(
          "Message has no sender or text."
        );

        return;

      }


      const cleanText =
        text.trim();


      if (!cleanText) {
        return;
      }


      // --------------------------------------------------------
      // MESSAGE LENGTH PROTECTION
      // --------------------------------------------------------

      if (
        cleanText.length >
        MAX_USER_MESSAGE_LENGTH
      ) {

        await sendWhatsAppMessage(
          from,
          "Your message is too long for one request. Please shorten it and send it again."
        );

        return;

      }


      // --------------------------------------------------------
      // RATE LIMIT
      // --------------------------------------------------------

      if (
        isRateLimited(from)
      ) {

        await sendWhatsAppMessage(
          from,
          "Please give MED NERD AI a few seconds before sending another message."
        );

        return;

      }


      console.log(
        `Message from ${from}: ${cleanText}`
      );


      // --------------------------------------------------------
      // GET CONVERSATION HISTORY
      // --------------------------------------------------------

      const history =
        getConversation(from);


      // --------------------------------------------------------
      // ASK GEMINI
      // --------------------------------------------------------

      const aiReply =
        await askGemini(
          cleanText,
          history
        );


      console.log(
        "AI reply:",
        aiReply
      );


      // --------------------------------------------------------
      // SAVE CONVERSATION
      // --------------------------------------------------------

      saveConversation(
        from,
        "user",
        cleanText
      );

      saveConversation(
        from,
        "model",
        aiReply
      );


      // --------------------------------------------------------
      // SEND AI ANSWER
      // --------------------------------------------------------

      console.log(
        "Attempting to send AI reply to:",
        from
      );


      await sendWhatsAppMessage(
        from,
        aiReply
      );


      console.log(
        "AI reply sent successfully."
      );


    } catch (error) {

      console.error(
        "Failed to process WhatsApp message:",
        error
      );


      // --------------------------------------------------------
      // FALLBACK
      // --------------------------------------------------------

      try {

        const message =
          req.body
            ?.entry?.[0]
            ?.changes?.[0]
            ?.value
            ?.messages?.[0];


        const from =
          message?.from;


        console.log(
          "Fallback recipient:",
          from
        );


        if (from) {

          await sendWhatsAppMessage(
            from,

            "MED NERD AI is temporarily busy processing your request. Please try again shortly."
          );


          console.log(
            "Fallback message sent."
          );

        }

      } catch (fallbackError) {

        console.error(
          "Fallback message failed:",
          fallbackError
        );

      }

    }

  }
);


// ============================================================
// PRIVACY POLICY
// ============================================================

app.get(
  "/privacy-policy",
  (req, res) => {

    res.status(200).send(`

      <html>

        <head>

          <title>
            MED NERD AI Privacy Policy
          </title>

          <meta
            name="viewport"
            content="width=device-width, initial-scale=1"
          >

        </head>

        <body
          style="
            font-family: Arial, sans-serif;
            max-width: 800px;
            margin: 40px auto;
            padding: 20px;
            line-height: 1.6;
          "
        >

          <h1>
            MED NERD AI Privacy Policy
          </h1>

          <p>
            <strong>Last updated:</strong>
            October 7, 2026
          </p>

          <p>
            MED NERD AI is an educational
            WhatsApp-based tutoring service
            operated by MED NERD.
          </p>

          <h2>
            Information We Receive
          </h2>

          <p>
            When you interact with MED NERD AI
            through WhatsApp, we may receive
            information such as your WhatsApp
            phone number, messages, and
            information necessary to provide
            the requested educational service.
          </p>

          <h2>
            How We Use Information
          </h2>

          <p>
            Information is used to respond
            to messages, provide educational
            assistance, operate and improve
            the service, and maintain the
            security and reliability of the
            platform.
          </p>

          <h2>
            Data Sharing
          </h2>

          <p>
            We do not sell personal information.
            Information may be processed by
            service providers and technology
            platforms necessary to operate
            the MED NERD AI service, including
            WhatsApp and Meta's services.
          </p>

          <h2>
            Data Retention
          </h2>

          <p>
            Information is retained only for
            as long as reasonably necessary
            to operate, maintain, and improve
            the service, or as required by law.
          </p>

          <h2>
            Contact
          </h2>

          <p>
            For privacy-related questions,
            contact MED NERD at
            mednerd50@gmail.com.
          </p>

        </body>

      </html>

    `);

  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  "0.0.0.0",
  () => {

    console.log(
      `MED NERD AI server running on port ${PORT}`
    );

  }
);

After replacing "server.js"

Commit it with:

Fix WhatsApp recipient diagnostics and Gemini retry handling

Then deploy on Render.

Do not change your environment variables. Do not paste your API keys into the code.

After deployment finishes, send one WhatsApp message to MED NERD AI. Then the crucial Render log will contain:

WhatsApp sender number: ...
Attempting to send AI reply to: ...

That will tell us exactly which number your code is giving Meta.
