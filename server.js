const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');
const OpenAI = require('openai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Gemini 2.0 Flash
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash-exp' });

// OpenAI pour TTS + Whisper
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

// Prompts
const PROMPT_SIMPLE = `Tu es un assistant pédagogique expert. Tu dois répondre de façon DIRECTE et UTILE.

ANALYSE L'IMAGE ET RÉPONDS SELON LE CAS :

📋 QCM / Choix multiple (A, B, C, D...) :
→ "Réponse [LETTRE]" puis justification en 5 mots max
→ Si plusieurs réponses possibles : "Réponses [LETTRES]"
→ Si tu hésites entre 2 : "Probablement [LETTRE], sinon [LETTRE]"

🔢 Calcul / Exercice math :
→ Donne le résultat final d'abord
→ Puis la méthode en une phrase
→ Si plusieurs étapes : résultat de chaque étape

🧠 Problème de logique / Raisonnement :
→ Donne la réponse directe
→ Explique le raisonnement clé en une phrase

📝 Question ouverte / Définition :
→ Réponds en 1-2 phrases claires et complètes

❓ Si pas clair / flou / illisible :
→ Dis "Image pas lisible" ou "Question pas visible"

RÈGLES :
- JAMAIS de "Bonjour", "Voici", "D'accord"
- Commence DIRECTEMENT par la réponse
- Maximum 3 phrases
- Français uniquement`;

const PROMPT_COMPLEX = `Tu es un assistant pédagogique expert. Tu reçois des IMAGES d'un cours + l'AUDIO de ce que dit le professeur.

PRIORITÉ : L'AUDIO. Le prof parle, écoute et réponds à ce qu'il demande.

ANALYSE ET RÉPONDS SELON LE CAS :

🎤 Le prof pose une question orale :
→ Réponds directement à sa question
→ Si c'est un calcul à faire : donne le résultat + méthode rapide
→ Si c'est une question de cours : réponds de façon claire et concise

📋 Le prof parle d'un QCM visible à l'écran :
→ "Réponse [LETTRE]" + justification courte
→ Si plusieurs réponses : "Réponses [LETTRES]"

🔢 Le prof fait un exercice / explique un calcul :
→ Donne la suite logique ou le résultat attendu
→ Si tu vois où il veut en venir, anticipe

🧠 Le prof explique un concept :
→ Résume le point clé en une phrase
→ Si tu peux compléter/clarifier, fais-le

❓ Audio pas clair ou question pas comprise :
→ Dis "Question pas claire" ou base-toi sur l'image seule

RÈGLES :
- JAMAIS de formule de politesse
- Commence DIRECTEMENT par la réponse
- Maximum 4 phrases
- Français uniquement`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: 'gemini-2.0-flash', modes: ['simple', 'complex'] });
});

// Main analyze endpoint
app.post('/analyze', async (req, res) => {
  const startTime = Date.now();

  try {
    const { image, images, audio } = req.body;

    // Detect mode
    const isComplex = (images && images.length > 1) || audio;
    const imageList = images || (image ? [image] : []);

    if (imageList.length === 0) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`[${new Date().toISOString()}] Mode: ${isComplex ? 'COMPLEX' : 'SIMPLE'}, Images: ${imageList.length}, Audio: ${audio ? 'yes' : 'no'}`);

    let transcription = '';

    // Whisper transcription if audio present
    if (audio && isComplex) {
      try {
        console.log('Transcribing audio with Whisper...');
        const audioBuffer = Buffer.from(audio, 'base64');
        const audioFile = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });

        const whisperResponse = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: 'fr'
        });

        transcription = whisperResponse.text;
        console.log(`Transcription: "${transcription.substring(0, 100)}..."`);
      } catch (whisperError) {
        console.error('Whisper error:', whisperError.message);
      }
    }

    // Build Gemini request
    const parts = [];

    // Add images
    for (const imgData of imageList) {
      const base64Data = imgData.replace(/^data:image\/\w+;base64,/, '');
      parts.push({
        inlineData: {
          mimeType: 'image/jpeg',
          data: base64Data
        }
      });
    }

    // Add prompt
    let prompt = isComplex ? PROMPT_COMPLEX : PROMPT_SIMPLE;
    if (transcription) {
      prompt += `\n\nLe professeur dit : "${transcription}"`;
    }
    parts.push({ text: prompt });

    // Call Gemini
    console.log('Calling Gemini 2.0 Flash...');
    const result = await model.generateContent(parts);
    const responseText = result.response.text();
    console.log(`Gemini response: "${responseText.substring(0, 100)}..."`);

    // Generate TTS
    console.log('Generating TTS...');
    const ttsResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: responseText,
      response_format: 'mp3',
      speed: 1.15
    });

    const audioArrayBuffer = await ttsResponse.arrayBuffer();
    const audioBase64 = Buffer.from(audioArrayBuffer).toString('base64');

    const totalTime = Date.now() - startTime;
    console.log(`Total time: ${totalTime}ms`);

    res.json({
      success: true,
      audio: audioBase64,
      text: responseText,
      mode: isComplex ? 'complex' : 'simple',
      timing: totalTime
    });

  } catch (error) {
    console.error('Error:', error);
    res.status(500).json({
      error: error.message,
      success: false
    });
  }
});

// Raw MP3 endpoint
app.post('/analyze/mp3', async (req, res) => {
  try {
    const { image, images, audio } = req.body;
    const isComplex = (images && images.length > 1) || audio;
    const imageList = images || (image ? [image] : []);

    if (imageList.length === 0) {
      return res.status(400).send('No image');
    }

    let transcription = '';
    if (audio && isComplex) {
      try {
        const audioBuffer = Buffer.from(audio, 'base64');
        const audioFile = new File([audioBuffer], 'audio.wav', { type: 'audio/wav' });
        const whisperResponse = await openai.audio.transcriptions.create({
          file: audioFile,
          model: 'whisper-1',
          language: 'fr'
        });
        transcription = whisperResponse.text;
      } catch (e) {}
    }

    const parts = [];
    for (const imgData of imageList) {
      const base64Data = imgData.replace(/^data:image\/\w+;base64,/, '');
      parts.push({ inlineData: { mimeType: 'image/jpeg', data: base64Data } });
    }

    let prompt = isComplex ? PROMPT_COMPLEX : PROMPT_SIMPLE;
    if (transcription) prompt += `\n\nLe professeur dit : "${transcription}"`;
    parts.push({ text: prompt });

    const result = await model.generateContent(parts);
    const responseText = result.response.text();

    const ttsResponse = await openai.audio.speech.create({
      model: 'tts-1',
      voice: 'nova',
      input: responseText,
      response_format: 'mp3',
      speed: 1.15
    });

    const audioArrayBuffer = await ttsResponse.arrayBuffer();
    res.set('Content-Type', 'audio/mpeg');
    res.send(Buffer.from(audioArrayBuffer));

  } catch (error) {
    console.error('Error:', error);
    res.status(500).send('Error');
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vision Assistant Server running on port ${PORT}`);
  console.log('Model: Gemini 2.0 Flash');
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /analyze');
  console.log('  POST /analyze/mp3');
});
