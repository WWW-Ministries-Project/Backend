export const applicationLiveTemplate = (
  loginLink: string,
  guestLink: string,
  itContact: string,
  name: string,
  email: string,
) => {
  return `
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <title>Application Live Notification</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        background-color: #f9f9f9;
        margin: 0;
        padding: 0;
      }
      .container {
        max-width: 650px;
        margin: 30px auto;
        background: #ffffff;
        border-radius: 10px;
        box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        padding: 30px;
        line-height: 1.6;
        color: #333;
      }
      h2 {
        color: #2c3e50;
        margin-bottom: 20px;
      }
      ul {
        padding-left: 20px;
      }
      a {
        color: #3498db;
        text-decoration: none;
      }
      a:hover {
        text-decoration: underline;
      }
      .footer {
        margin-top: 40px;
        font-size: 14px;
        color: #777;
        border-top: 1px solid #eee;
        padding-top: 15px;
        text-align: center;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h2>🎉 Our Application is Now Live!</h2>
      <p>Dear <strong>${name}</strong>,</p>

      <p>We are excited to announce that the <strong>WWM Ministry Application</strong> is officially <strong>live</strong>! 🚀</p>

      <p>You can now place your orders directly through the platform:</p>

      <ul>
        <li><a href="${loginLink}">Login here</a> if you have already signed up on the platform.</li>
        <li><a href="${guestLink}">Use this guest link</a> if you don’t have an account yet.</li>
      </ul>

      <p>
        For first-time users:  
        Please contact the <strong>IT Department</strong> at <a href="mailto:${itContact}">${itContact}</a>  
        to obtain your <strong>default password</strong>.  
        Make sure to use the <strong>${email}</strong> you provided during registration.
      </p>

      <p>We look forward to serving you better with this new platform!</p>

      <div class="footer">
        Best regards,<br>
        <strong>World Wide Word Ministries</strong>
      </div>
    </div>
  </body>
  </html>
  `;
};
