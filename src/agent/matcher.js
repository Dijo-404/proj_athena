import { getAllSchemes, getSchemeById } from "../data/db.js";

export async function matchScholarships(profile) {
  try {
    const schemes = await getAllSchemes();
    const matches = [];

    for (const scheme of schemes) {
      const evaluation = evaluateScheme(scheme, profile);
      if (!evaluation.eligible) continue;
      matches.push({
        id: scheme.id,
        name: scheme.name,
        name_ta: scheme.name_ta,
        amount: scheme.amount,
        frequency: scheme.frequency,
        portal: scheme.portal,
        deadline: scheme.deadline,
        reasons: evaluation.reasons,
        score: evaluation.score,
      });
    }

    matches.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return (b.amount || 0) - (a.amount || 0);
    });

    return { ok: true, matches: matches.slice(0, 8) };
  } catch (err) {
    return { ok: false, error: err?.message || "Match failed." };
  }
}

export async function checkEligibility(schemeId, studentProfile) {
  const scheme = await getSchemeById(schemeId);
  if (!scheme) return { ok: false, error: "Scheme not found." };
  const evaluation = evaluateScheme(scheme, studentProfile || {});
  return {
    ok: true,
    scheme_id: scheme.id,
    eligible: evaluation.eligible,
    reasons: evaluation.reasons,
    missing: evaluation.missing,
  };
}

export async function getDeadline(schemeId) {
  const scheme = await getSchemeById(schemeId);
  if (!scheme) return { ok: false, error: "Scheme not found." };
  return { ok: true, scheme_id: scheme.id, deadline: scheme.deadline || null };
}

function evaluateScheme(scheme, profile) {
  const eligibility = scheme.eligibility || {};
  const reasons = [];
  const missing = [];
  let score = 0;

  const casteOk = matchesCaste(eligibility.caste, profile.caste_category);
  if (casteOk === null) missing.push("caste_category");
  else if (!casteOk)
    return { eligible: false, reasons: ["Caste category does not match."], missing: [] };
  else {
    reasons.push("Caste category matches.");
    score += 2;
  }

  const incomeOk = matchesIncome(eligibility.max_income, profile.annual_income);
  if (incomeOk === null) missing.push("annual_income");
  else if (!incomeOk)
    return { eligible: false, reasons: ["Income exceeds scheme limit."], missing: [] };
  else {
    reasons.push("Income is within the allowed limit.");
    score += 2;
  }

  const courseOk = matchesCourse(eligibility.course_level, profile.course_level);
  if (courseOk === null) missing.push("course_level");
  else if (!courseOk)
    return { eligible: false, reasons: ["Course level does not match."], missing: [] };
  else {
    reasons.push("Course level matches the scheme.");
    score += 2;
  }

  const hasPercentageRequirement =
    eligibility.min_percentage !== null && eligibility.min_percentage !== undefined;
  const percentageOk = matchesPercentage(eligibility.min_percentage, profile.percentage);
  if (percentageOk === null) {
    if (hasPercentageRequirement) missing.push("percentage");
  } else if (!percentageOk) {
    return { eligible: false, reasons: ["Percentage below minimum."], missing: [] };
  } else if (hasPercentageRequirement) {
    reasons.push("Percentage requirement met.");
    score += 1;
  }

  if (missing.length > 0) {
    reasons.push("Profile incomplete for full verification.");
    score -= 1;
  }

  return { eligible: true, reasons, missing, score };
}

function matchesCaste(allowed, caste) {
  if (!allowed || allowed.length === 0) return true;
  if (!caste) return null;
  return allowed.includes(caste);
}

function matchesIncome(maxIncome, income) {
  if (maxIncome === null || maxIncome === undefined) return true;
  if (income === null || income === undefined) return null;
  return income <= maxIncome;
}

function matchesCourse(allowed, courseLevel) {
  if (!allowed || allowed.length === 0) return true;
  if (!courseLevel) return null;
  return allowed.includes(courseLevel);
}

function matchesPercentage(minPercentage, percentage) {
  if (minPercentage === null || minPercentage === undefined) return true;
  if (percentage === null || percentage === undefined) return null;
  return percentage >= minPercentage;
}
