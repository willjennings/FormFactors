import { GoogleGenAI, Type } from "@google/genai";

async function getBBoxes() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  const imageUrl = "https://i.ibb.co/jvpkrYV9/Squareimg.png";
  
  const response = await ai.models.generateContent({
    model: "gemini-3-flash-preview",
    contents: [
      {
        parts: [
          { text: `Analyze the image at this URL: ${imageUrl}. 
          Provide bounding boxes in [ymin, xmin, ymax, xmax] format (normalized 0-1000) for the following objects if they exist:
          - Fun Beach wooden sign
          - The snowman
          - The bucket (red hat) on snowman
          - The sandcastle
          - The flag on the sandcastle
          - The smiling palm tree
          - Coconut (left juggled)
          - Coconut (right juggled)
          - The crab with the pirate hat
          - The pirate hat on the crab
          - The orange starfish
          - The surfing penguin
          - The blue monster
          - The red monster
          - The giant beach ball
          - The sun
          - The cloud (left)
          - The cloud (middle)
          - The cloud (right)
          
          Also identify any other prominent interactive objects.
          Return the result as a JSON array of objects with 'name' and 'bbox' properties.` }
        ]
      }
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            name: { type: Type.STRING },
            bbox: { 
              type: Type.ARRAY, 
              items: { type: Type.NUMBER },
              description: "[ymin, xmin, ymax, xmax]"
            }
          },
          required: ["name", "bbox"]
        }
      }
    }
  });

  console.log(response.text);
}

getBBoxes();
