import os
import json
import pypdf
import google.generativeai as genai

# 1. Setup API Key
os.environ["GOOGLE_API_KEY"] = "YOUR_GEMINI_API_KEY"
genai.configure(api_key=os.environ["GOOGLE_API_KEY"])

def extract_text_from_pdf(pdf_path):
    reader = pypdf.PdfReader(pdf_path)
    text = ""
    for page in reader.pages:
        text += page.extract_text()
    return text

def generate_quiz_json(raw_text):
    model = genai.GenerativeModel('gemini-1.5-flash')
    
    prompt = f"""
    The following text contains questions and their correct answers. 
    1. Identify each question and its correct answer.
    2. For every question, create 3 additional plausible but incorrect multiple-choice options (distractors).
    3. Return the result strictly as a valid JSON array of objects.
    
    JSON Structure:
    [
      {{
        "question": "The text of the question",
        "options": ["Correct Answer", "Distractor 1", "Distractor 2", "Distractor 3"],
        "answer": "Correct Answer"
      }}
    ]

    Text to process:
    {raw_text}
    """

    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"}
    )
    
    return json.loads(response.text)

# --- Execution ---
pdf_file = "your_questions.pdf"
extracted_text = extract_text_from_pdf(pdf_file)
quiz_data = generate_quiz_json(extracted_text)

# Save to a local JSON file
with open("quiz_output.json", "w") as f:
    json.dump(quiz_data, f, indent=4)

print("JSON file generated successfully!")