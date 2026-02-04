const express = require('express');
const cors = require('cors');
const { GoogleGenerativeAI } = require('@google/generative-ai');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Gemini 2.0 Flash - SEULE API utilisée
const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
const model = genAI.getGenerativeModel({ model: 'gemini-2.0-flash' });

// Prompts
const PROMPT_SIMPLE = `Tu es un assistant qui RÉSOUT les exercices. Tu DONNES LA RÉPONSE, point final.

RÈGLES ABSOLUES :
1. TU NE POSES JAMAIS DE QUESTION - tu réponds directement
2. TU DONNES TOUJOURS UNE RÉPONSE même si l'image est floue - fais de ton mieux
3. Si plusieurs questions visibles, réponds à TOUTES
4. Si on te demande de choisir (numérique ou dérivées, etc.) → donne LES DEUX

FORMAT DE RÉPONSE :

📋 QCM : "Réponse A" (ou B, C, D) + 5 mots de justification max

🔢 Calcul/Math :
→ Résultat final EN PREMIER
→ Puis calcul rapide si utile
→ Si plusieurs questions : résultat 1, résultat 2, etc.

🧠 Problème complexe :
→ Donne la solution complète
→ Résultats numériques ET formules si demandé

INTERDIT :
- Poser des questions ("veux-tu...", "préfères-tu...")
- Dire "image pas lisible" sauf si vraiment IMPOSSIBLE à lire
- Les formules de politesse
- Demander des précisions

Réponds en français, MAX 4 phrases, VA DROIT AU BUT.`;

const PROMPT_COMPLEX = `Tu es un assistant qui RÉSOUT les exercices. Tu reçois des images + ce que dit le prof.

RÈGLES ABSOLUES :
1. TU NE POSES JAMAIS DE QUESTION - tu réponds directement
2. TU DONNES TOUJOURS UNE RÉPONSE même si flou
3. Réponds à TOUT ce qui est visible/demandé
4. Si choix à faire → donne TOUT (numérique + formules, etc.)

Si le prof parle : réponds à SA question
Sinon : résous ce qui est visible à l'écran

FORMAT :
- QCM : "Réponse A" + justification courte
- Calcul : Résultat d'abord, puis méthode
- Problème : Solution complète

INTERDIT :
- Poser des questions
- Dire "pas lisible"
- Formules de politesse

Français, MAX 4 phrases, DIRECT.`;

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', model: 'gemini-2.0-flash', tts: 'browser', modes: ['simple', 'complex'] });
});

// Main analyze endpoint - retourne TEXTE seulement, TTS fait par le navigateur
app.post('/analyze', async (req, res) => {
  const startTime = Date.now();

  try {
    const { image, images, transcription } = req.body;

    // Detect mode
    const isComplex = (images && images.length > 1) || transcription;
    const imageList = images || (image ? [image] : []);

    if (imageList.length === 0) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log(`[${new Date().toISOString()}] Mode: ${isComplex ? 'COMPLEX' : 'SIMPLE'}, Images: ${imageList.length}, Transcription: ${transcription ? 'yes' : 'no'}`);

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

    const totalTime = Date.now() - startTime;
    console.log(`Total time: ${totalTime}ms`);

    // Retourne TEXTE seulement - le navigateur fait le TTS
    res.json({
      success: true,
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Vision Assistant Server running on port ${PORT}`);
  console.log('Model: Gemini 2.0 Flash (Google only - no OpenAI)');
  console.log('TTS: Browser-based (Web Speech API)');
  console.log('Endpoints:');
  console.log('  GET  /health');
  console.log('  POST /analyze');
});
