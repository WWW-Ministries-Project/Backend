export const confirmTemplate = (mailDetails: any) => {
  return `
    <!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Email Confirmation</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            margin: 0;
            padding: 0;
            background-color: #f4f4f4;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            background-color: #ffffff;
            border-radius: 8px;
            box-shadow: 0px 0px 10px 0px rgba(0,0,0,0.1);
        }
        h1 {
            color: #333333;
        }
        p {
            color: #666666;
            line-height: 1.5;
        }
        .button {
            display: inline-block;
            padding: 10px 20px;
            background-color: #007bff;
            color: #ffffff;
            text-decoration: none;
            border-radius: 4px;
        }
        .button:hover {
            background-color: #0056b3;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>Email Confirmation</h1>
        <p>Hello ${mailDetails.name}!</p>
        <p>You've been invited to the WWWM System! Please click the find below your default credential.</p>
        <p><strong>email:</strong> ${mailDetails.email}</p>
        <p><strong>Password:</strong> ${mailDetails.password}</p>
        <a href="${mailDetails.frontend_url}" class="button">Login Here</a>
        <p>Have a great Day!</p>
    </div>
</body>
</html>

    `;
};
