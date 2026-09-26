/* =========================================================
   CEMICS — Intelligent Candidate Screening engine
   A transparent, explainable rule-based scorer (no external
   AI API key required). It compares a seeker's profile
   (skills, field of interest, qualification) and CV text
   against a vacancy's requirements and produces:
     - a 0-100 match score
     - a breakdown so employers can see *why* it scored that
     - a boolean "recommended" flag for the top tier

   This can later be swapped for a call to the Anthropic API
   (see /backend/utils/aiClient.js stub) without changing the
   route code, since callers only depend on scoreApplication().
========================================================= */

const QUALIFICATION_RANK = {
  "grade 10": 1,
  "grade 12 / matric": 2,
  "grade 12": 2,
  matric: 2,
  "certificate": 3,
  "diploma": 4,
  "bachelor's degree": 5,
  "bachelors degree": 5,
  "honours degree": 6,
  "postgraduate degree": 7,
};

function normalize(text) {
  return (text || "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function uniqueWords(text) {
  return Array.from(new Set(normalize(text)));
}

function qualificationScore(seekerQualification, minQualification) {
  if (!minQualification) return { score: 20, note: "No minimum qualification specified." };
  const seekerRank = QUALIFICATION_RANK[(seekerQualification || "").toLowerCase().trim()] || 0;
  const requiredRank = QUALIFICATION_RANK[(minQualification || "").toLowerCase().trim()] || 0;
  if (requiredRank === 0) return { score: 15, note: "Requirement not recognised." };
  if (seekerRank >= requiredRank) {
    return { score: 20, note: `Meets required qualification (${minQualification}).` };
  }
  if (seekerRank === requiredRank - 1) {
    return { score: 10, note: `Slightly below required qualification (${minQualification}).` };
  }
  return { score: 2, note: `Below required qualification (${minQualification}).` };
}

function keywordOverlapScore(candidateText, vacancySkills, vacancyText, weight) {
  const candidateWords = new Set(uniqueWords(candidateText));
  const skillList = (vacancySkills || []).map((s) => s.toLowerCase().trim()).filter(Boolean);

  let matchedSkills = [];
  skillList.forEach((skill) => {
    const skillWords = uniqueWords(skill);
    const hit = skillWords.length > 0 && skillWords.every((w) => candidateText.toLowerCase().includes(w));
    if (hit) matchedSkills.push(skill);
  });

  const vacancyWords = uniqueWords(vacancyText);
  const overlap = vacancyWords.filter((w) => candidateWords.has(w) && w.length > 3);
  const overlapRatio = vacancyWords.length ? overlap.length / vacancyWords.length : 0;

  const skillRatio = skillList.length ? matchedSkills.length / skillList.length : overlapRatio;
  const score = Math.round(weight * Math.min(1, skillRatio * 0.75 + overlapRatio * 0.25));

  return { score, matchedSkills, skillList };
}

/**
 * Score a seeker's application against a vacancy.
 * @param {object} seekerProfile - parsed `profile` JSON from users table (qualification, fieldOfInterest, skills)
 * @param {string} coverLetter
 * @param {object} vacancy - vacancy row with skills (array), requirements, description, minQualification, industry
 * @returns {{ score:number, recommended:boolean, breakdown:object }}
 */
function scoreApplication(seekerProfile, coverLetter, vacancy) {
  const candidateText = [
    seekerProfile.skills || "",
    seekerProfile.fieldOfInterest || "",
    coverLetter || "",
  ].join(" ");

  const vacancyText = [vacancy.description || "", vacancy.requirements || ""].join(" ");
  const vacancySkills = Array.isArray(vacancy.skills) ? vacancy.skills : [];

  const skillsResult = keywordOverlapScore(candidateText, vacancySkills, vacancyText, 60);
  const qualResult = qualificationScore(seekerProfile.qualification, vacancy.minQualification);

  const fieldMatch =
    seekerProfile.fieldOfInterest &&
    vacancy.industry &&
    seekerProfile.fieldOfInterest.toLowerCase().trim() === vacancy.industry.toLowerCase().trim();
  const fieldScore = fieldMatch ? 20 : 5;

  const total = Math.max(0, Math.min(100, skillsResult.score + qualResult.score + fieldScore));

  return {
    score: total,
    recommended: total >= 65,
    breakdown: {
      skillsScore: skillsResult.score,
      matchedSkills: skillsResult.matchedSkills,
      requiredSkills: skillsResult.skillList,
      qualificationScore: qualResult.score,
      qualificationNote: qualResult.note,
      fieldOfInterestScore: fieldScore,
      fieldMatch: Boolean(fieldMatch),
      summary:
        total >= 80
          ? "Strong match — recommended for shortlist."
          : total >= 65
          ? "Good match — worth shortlisting."
          : total >= 40
          ? "Partial match — review manually."
          : "Weak match against this vacancy's requirements.",
    },
  };
}

module.exports = { scoreApplication };
