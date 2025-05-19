export const confirmTemplate = (mailDetails: any) => {
  return `
    <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Account Activation</title>
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
            <img src="YOUR_LOGO_URL" alt="Company Logo">
            <h1>Welcome to [Your Company Name]</h1>
        </div>
        <div class="content">
              <h1>Email Confirmation</h1>
        <p>Hello ${mailDetails.name}!</p>
        <p>You've been invited to the WWWM System! Please click the find below your default credential.</p>
        <p><strong>email:</strong> ${mailDetails.email}</p>
        <p><strong>Password:</strong> ${mailDetails.password}</p>
        <a href="${mailDetails.frontend_url}" class="button">Login Here</a>
        <p>Have a great Day!</p>
        </div>
        <div class="footer">
            © 2025 Your Company Name. All rights reserved.
        </div>
    </div>
</body>
</html>
    `;
};
