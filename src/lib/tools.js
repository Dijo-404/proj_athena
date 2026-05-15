export const TOOL_SCHEMA = [
  {
    type: "function",
    function: {
      name: "match_scholarships",
      description:
        "Find scholarships matching the student's profile from the local database.",
      parameters: {
        type: "object",
        properties: {
          caste_category: {
            type: "string",
            enum: ["BC", "MBC", "SC", "ST", "OC", "OBC"],
            description: "Student's caste category",
          },
          annual_income: {
            type: "number",
            description: "Family annual income in INR",
          },
          course_level: {
            type: "string",
            enum: ["10th", "12th", "UG", "PG", "Diploma", "ITI"],
            description: "Current course level",
          },
          percentage: {
            type: "number",
            description: "Last exam percentage",
          },
          district: {
            type: "string",
            description: "District in Tamil Nadu",
          },
        },
        required: ["caste_category", "annual_income", "course_level"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "fill_field",
      description:
        "Fill a specific form field on the current scholarship portal page. Each call requires user approval in the side panel.",
      parameters: {
        type: "object",
        properties: {
          field_label: { type: "string", description: "Visible label of the form field" },
          value: { type: "string", description: "Value to enter" },
          action: {
            type: "string",
            enum: ["type", "select", "click", "upload"],
            description: "Interaction type",
          },
        },
        required: ["field_label", "value", "action"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "check_eligibility",
      description: "Verify if the student is eligible for a specific scheme.",
      parameters: {
        type: "object",
        properties: {
          scheme_id: { type: "string" },
          student_profile: { type: "object" },
        },
        required: ["scheme_id", "student_profile"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_deadline",
      description: "Get application deadline for a scheme.",
      parameters: {
        type: "object",
        properties: { scheme_id: { type: "string" } },
        required: ["scheme_id"],
      },
    },
  },
];
