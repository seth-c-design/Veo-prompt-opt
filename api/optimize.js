// /api/optimize.js (or .mjs if you renamed)
import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import { promises as fs } from 'fs';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Parse FormData
  const form = formidable({ multiples: false });
  const [fields, files] = await new Promise((resolve, reject) => {
    form.parse(req, (err, fields, files) => {
      if (err) reject(err);
      resolve([fields, files]);
    });
  });

  const userPrompt = fields.userPrompt?.[0] || '';
  const imageUrl = fields.imageUrl?.[0] || '';
  let imagePart = null;

  if (!userPrompt.trim()) {
    return res.status(400).json({ error: 'Prompt cannot be empty.' });
  }

  // Handle image: File or URL
  if (files.image?.[0]) {
    const file = files.image[0];
    const buffer = await fs.readFile(file.filepath);
    imagePart = {
      inlineData: {
        data: buffer.toString('base64'),
        mimeType: file.mimetype || 'image/jpeg'  // Detect or assume JPEG
      }
    };
    await fs.unlink(file.filepath);
  } else if (imageUrl) {
    // Gemini supports URLs directly, but for consistency, you could fetch base64 here if needed
    imagePart = {
      fileData: {
        fileUri: imageUrl,
        mimeType: 'image/jpeg'  // Adjust based on URL
      }
    };
  }

  // Build prompt
  let fullPrompt = `
    You are an expert Midjourney prompt engineer. Your task is to take a user's simple idea and expand it into a detailed, structured prompt. The output must be a single line following this exact format:
    <Foreground: [detailed description]> <Midground: [detailed description]> <Background: [detailed description]> | <Style: [detailed description]>

    User's Idea: "${userPrompt}"`;

  if (imagePart) {
    fullPrompt = `
      Analyze the provided image and incorporate them into a final single structured prompt.
      
      User's Idea: "${userPrompt}"
      
      Optimized Prompt:`;
  } else {
    fullPrompt += '\nOptimized Prompt:';
  }

  try {
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel({ model: 'gemini-1.5-flash' });  // Free, vision-capable, fast

    const content = [{ text: fullPrompt }];
    if (imagePart) {
      content.push(imagePart);  // Add image to content array
    }

    const result = await model.generateContent({
      contents: [{ role: 'user', parts: content }],
      generationConfig: {
        temperature: 1,
        maxOutputTokens: 1024,
        topP: 1
      }
    });

    const optimizedText = result.response.text().trim();
    res.status(200).json({ optimizedText });

  } catch (error) {
    console.error('Gemini API Error:', error);
    res.status(500).json({ error: `An internal server error occurred: ${error.message}` });
  }
}
