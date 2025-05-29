export const forgetPasswordTemplate = (mailDetails: {
  user_name: string;
  link: string;
}) => {
  const { user_name, link } = mailDetails;
  return `
  <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Password Reset Request</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            background-color: #f4f4f4;
            margin: 0;
            padding: 0;
        }
        .container {
            width: 100%;
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0 4px 20px rgba(0,0,0,0.15);
            overflow: hidden;
        }
        .header {
            background-color: #6539C4;
            color: #ffffff;
            text-align: center;
            padding: 20px;
        }
        .header img {
            max-width: 150px;
            margin-bottom: 10px;
        }
        .content {
            padding: 30px;
            color: #333333;
        }
        .button {
            display: inline-block;
            padding: 15px 30px;
            color: #ffffff;
            background-color: #6539C4;
            text-decoration: none;
            border-radius: 5px;
            margin-top: 20px;
        }
        .footer {
            text-align: center;
            color: #888888;
            padding: 20px;
            font-size: 12px;
            background-color: #f4f4f4;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="header">
            <img src="https://res.cloudinary.com/dt8vgj0u3/image/upload/v1747597889/main-logo_nuhmgv.svg" alt="Company Logo">
            <h1>Password Reset Request</h1>
        </div>
        <div class="content">
            <p>Hi ${user_name},</p>
            <p>You recently requested to reset your password. Click the button below to set a new password:</p>
            <a href="${link}" class="button">Reset Password</a>
            <p>If you did not request a password reset, please ignore this email or contact support if you have any questions.</p>
            <p>Thank you</p>
        </div>
        <div class="footer">
            © 2025 World Wide Word Ministires. All rights reserved.
        </div>
    </div>
</body>
</html>
  `;
};
