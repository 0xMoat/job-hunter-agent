Evaluate whether the AI assistant successfully completed the user's job-hunting task on a continuous scale from 0 to 1.

## Scoring Criteria

Score 1.0 if the assistant:
- Correctly identified what the user wanted (job search, cover letter, company research, etc.)
- Took the appropriate action (called the right tool or provided relevant advice)
- Delivered a complete response that fulfills the user's request
- OR: correctly identified that required context is missing (e.g. no position selected, no
  application on record) and asked a targeted clarifying question instead of hallucinating a response
- OR: correctly declined an out-of-scope request (e.g. weather, system prompt leak) and
  redirected the user to job-hunting topics

Score 0.5 if the assistant:
- Identified the task correctly but only partially addressed it
- Called the right tool but the response was incomplete
- Asked a clarifying question but it was too vague or missed the key missing piece

Score 0.0 if the assistant:
- Misunderstood the user's request
- Failed to take any relevant action
- Provided generic or irrelevant information
- Hallucinated data (invented job listings, fabricated application records, etc.)

## Instructions
Compare the actual generation against the expected outcome. Think step by step.
