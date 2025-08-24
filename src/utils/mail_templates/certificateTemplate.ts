export const certificateTemplate = (
  name: string,
  certificateId: string,
  program_name: string,
) => {
  const completionDate = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  return `
        <!DOCTYPE html>
        <html>
    <head><style>/* styles here */</style></head>
    <body>
      <h1>Certificate of Completion</h1>
      <p>This certifies that <strong>${name}</strong> has successfully completed the course <strong>${program_name}</strong> on ${completionDate}.</p>
    </body>
  </html>
        
        
        `;
};
