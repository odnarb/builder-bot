// ai-agent.js

// 🧠 Ask ChatGPT for block structure
export async function getStructureFromAI(message) {
  const res = await fetch(`${process.env.API_URL}/api/ai-get-structure`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.AUTH_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });

  const data = await res.json();
  return data.structure;
}
