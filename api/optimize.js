import { GoogleGenerativeAI } from '@google/generative-ai';
import formidable from 'formidable';
import { promises as fs } from 'fs';
import path from 'path';

// --- Configuration ---
const PROMPT_TEMPLATE_PATH = 'assets/Prompt_template.json';
const MODEL_CONFIG = { model: 'gemini-1.5-flash-latest' };
const GENERATION_CONFIG = {
  temperature: 1.2,
  topP: 0.95,
  maxOutputTokens: 8192,
  responseMimeType: "application/json",
};

// --- System Prompt ---
const getSystemPrompt = (template) => `
You are a specialized AI assistant for generating video prompts for Google's VEO model. Your only function is to populate the provided JSON template based on the user's idea. Adhere strictly to the following rules:

1.  **Output Format:** You MUST respond with only a valid JSON object that perfectly matches the structure of the template provided below. Do not include any text, explanation, or markdown before or after the JSON.
2.  **Template Adherence:** Use the exact keys and structure from the JSON template. Do not add, remove, or rename any keys.
3.  **Content:** Fill in the template's values with hyper-detailed, director-level descriptions inferred from the user's concept.
4.  **Duration:** The total video duration MUST NOT exceed 8 seconds. All timeline events must be within this limit.

This is the only format you will ever use. Do not deviate. Here is the template to follow:
`;

const getFilepathToPromptTemplate = () => {
    const isVercel = process.env.VERCEL;
    if(isVercel) {
        return path.join(process.cwd(), PROMPT_TEMPLATE_PATH);
    }
    return PROMPT_TEMPLATE_PATH;
}

// --- Main Handler ---
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    // 1. Read the prompt template
    const templatePath = getFilepathToPromptTemplate();
    const template = await fs.readFile(templatePath, 'utf-8');
    const systemPrompt = getSystemPrompt(template);

    // 2. Parse incoming form data
    const form = formidable({ multiples: false });
    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, fields, files) => {
        if (err) reject(err);
        resolve([fields, files]);
      });
    });

    const userPrompt = fields.userPrompt?.[0] || '';
    if (!userPrompt.trim()) {
      return res.status(400).json({ error: 'Prompt cannot be empty.' });
    }

    // 3. Prepare content for Gemini API
    const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);
    const model = genAI.getGenerativeModel(MODEL_CONFIG);

    const parts = [
      { text: systemPrompt },
      { text: template },
      { text: userPrompt },
    ];

    // Handle optional image upload
    if (files.image?.[0]) {
      const file = files.image[0];
      const buffer = await fs.readFile(file.filepath);
      parts.push({
        inlineData: {
          mimeType: file.mimetype || 'image/jpeg',
          data: buffer.toString('base64'),
        },
      });
      await fs.unlink(file.filepath); // Clean up temp file
    }

    // 4. Generate content
    const result = await model.generateContent({
      contents: [{ role: 'user', parts }],
      generationConfig: GENERATION_CONFIG,
    });

    const responseText = result.response.text();
    
    // 5. Validate and send response
    // The response should be a valid JSON string as requested by responseMimeType
    // We will parse to be sure, and then stringify for consistent transport.
    try {
      const jsonResponse = JSON.parse(responseText);
      res.status(200).json({ optimizedText: JSON.stringify(jsonResponse, null, 2) });
    } catch (e) {
      console.error("Failed to parse AI response as JSON:", responseText);
      res.status(500).json({ error: "The AI returned an invalid response. Please try again." });
    }

  } catch (error) {
    console.error('API Error:', error);
    res.status(500).json({ error: `An internal server error occurred: ${error.message || error}` });
  }
}