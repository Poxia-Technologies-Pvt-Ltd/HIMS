export const generateTestParameters = async (req, res) => {
  try {
    const { test_code, test_name, category_name, sample_type, container_name } = req.body;

    // Validate required fields
    if (!test_code || !test_name || !category_name || !sample_type) {
      return res.status(400).json({
        success: false,
        message: 'Test code, test name, category, and sample type are required'
      });
    }

    // Create a detailed prompt for the AI model
    const prompt = `You are a medical laboratory expert. Generate comprehensive test parameters for the following laboratory test:

Test Code: ${test_code}
Test Name: ${test_name}
Category: ${category_name}
Sample Type: ${sample_type}
Container: ${container_name || 'Not specified'}

Please generate a JSON array of test parameters with the following structure for each parameter:
{
  "parameter_code": "Short code like HB, WBC, RBC (max 5 chars)",
  "parameter_name": "e.g., Hemoglobin",
  "parameter_unit": "e.g., g/dL",
  "result_type": "numeric",
  "display_order": 0,
  "is_calculated": false,
  "formula": "",
  "options": "",
  "min_value": 13.5,
  "max_value": 17.5,
  "use_demographic_ranges": true,
  "men_min_value": 13.5,
  "men_max_value": 17.5,
  "women_min_value": 12.0,
  "women_max_value": 15.5,
  "kids_min_value": 11.5,
  "kids_max_value": 15.5
}

FIELD DESCRIPTIONS:
- parameter_code: Short unique code (2-5 uppercase letters), e.g., HB, WBC, RBC, GLU
- parameter_name: Full descriptive name of the parameter
- parameter_unit: Standard medical unit (g/dL, mmol/L, U/L, etc.)
- result_type: Always use "numeric" for measurable values, "select" for categorical (Positive/Negative), "text" for descriptive
- display_order: Sequential number starting from 0
- is_calculated: true if derived from other parameters, false for direct measurements
- formula: Mathematical expression using other parameter_codes (e.g., "(MCHC * RBC) / 100"), only if is_calculated=true
- options: Comma-separated values for select type (e.g., "Positive,Negative,Borderline"), empty for numeric/text
- min_value/max_value: General reference range boundaries (main reference range)
- use_demographic_ranges: true if men/women/kids have different normal ranges
- men_min_value/max_value: Demographic-specific reference range for men
- women_min_value/max_value: Demographic-specific reference range for women  
- kids_min_value/max_value: Demographic-specific reference range for children

CONSIDERATIONS:
1. For Hematology tests (CBC): Include HB, RBC, WBC, PCV, MCV, MCH, MCHC, Platelets
2. For Biochemistry (Glucose, Lipid): Include relevant analytes with appropriate units
3. Most parameters are numeric (is_calculated=false, formula="")
4. Calculated fields: MCH, MCHC are typically calculated from HB, RBC, PCV
5. Set use_demographic_ranges=true for parameters with gender differences (HB, RBC, etc.)
6. Generate 5-10 parameters for comprehensive test coverage

Return ONLY the JSON array without any additional text or explanation.`;

    // Call Ollama API
    const ollamaResponse = await fetch('http://172.16.11.160:11434/api/generate', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-oss:120b-cloud',
        prompt: prompt,
        stream: false,
        options: {
          temperature: 0.3,
          top_p: 0.9,
          max_tokens: 2000
        }
      })
    });

    if (!ollamaResponse.ok) {
      throw new Error('Failed to generate parameters using AI');
    }

    const ollamaData = await ollamaResponse.json();
    const generatedText = ollamaData.response;

    // Try to parse the JSON response
    let parameters = [];
    try {
      // Extract JSON from the response (in case there's extra text)
      const jsonMatch = generatedText.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        parameters = JSON.parse(jsonMatch[0]);
      } else {
        parameters = JSON.parse(generatedText);
      }
    } catch (parseError) {
      console.error('Error parsing AI response:', parseError);
      return res.status(500).json({
        success: false,
        message: 'Failed to parse AI-generated parameters'
      });
    }

    // Validate the generated parameters
    if (!Array.isArray(parameters) || parameters.length === 0) {
      return res.status(500).json({
        success: false,
        message: 'AI failed to generate valid parameters'
      });
    }

    res.json({
      success: true,
      data: parameters
    });

  } catch (error) {
    // VAPT #8 (Improper Error Handling): log the real error server-side only
    // — the client shouldn't see raw AI-provider/driver error text.
    console.error('Error generating test parameters:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to generate test parameters'
    });
  }
};
