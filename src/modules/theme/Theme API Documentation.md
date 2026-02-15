# 📘 Annual Theme API Documentation

**Base URL**

```
/theme
```

All endpoints return JSON.

---

## 1️⃣ Create Annual Theme

**POST** `/theme/create-theme`

**Request Body**

```json
{
  "year": 2026,
  "title": "Greater Glory",
  "verseReference": "Haggai 2:9",
  "verse": "The glory of this latter house shall be greater...",
  "message": "This year is a year of divine elevation.",
  "imageUrl": "https://cdn.example.com/theme-2026.png",
  "isActive": true
}
```

**Response (201)**

```json
{
  "message": "Annual theme created successfully",
  "data": {
    "id": 1,
    "year": 2026,
    "title": "Greater Glory",
    "verseReference": "Haggai 2:9",
    "verse": "The glory of this latter house shall be greater...",
    "message": "This year is a year of divine elevation.",
    "imageUrl": "https://cdn.example.com/theme-2026.png",
    "isActive": true,
    "createdAt": "2026-01-16T10:30:00.000Z"
  }
}
```

---

## 2️⃣ Get All Annual Themes

**GET** `/theme/get-themes`

**Response (200)**

```json
{
  "data": [
    {
      "id": 2,
      "year": 2025,
      "title": "Dominion",
      "isActive": false
    },
    {
      "id": 1,
      "year": 2026,
      "title": "Greater Glory",
      "isActive": true
    }
  ]
}
```

---

## 3️⃣ Get Active Annual Theme

**GET** `/api/get-active-theme`

**Response (200)**

```json
{
  "data": {
    "id": 1,
    "year": 2026,
    "title": "Greater Glory",
    "verseReference": "Haggai 2:9",
    "verse": "The glory of this latter house shall be greater...",
    "message": "This year is a year of divine elevation.",
    "imageUrl": "https://cdn.example.com/theme-2026.png",
    "isActive": true
  }
}
```

---

## 4️⃣ Get One Annual Theme

**GET** `/theme/get-theme?id=1`

**Query Parameters**

| Name | Type   | Required |
| ---- | ------ | -------- |
| id   | number | yes      |

**Response (200)**

```json
{
  "data": {
    "id": 1,
    "year": 2026,
    "title": "Greater Glory",
    "verseReference": "Haggai 2:9",
    "verse": "The glory of this latter house shall be greater...",
    "message": "This year is a year of divine elevation.",
    "imageUrl": "https://cdn.example.com/theme-2026.png",
    "isActive": true
  }
}
```

---

## 5️⃣ Update Annual Theme

**PATCH** `/theme/update-theme?id=1`

**Request Body (partial allowed)**

```json
{
  "title": "Greater Glory and Power",
  "isActive": true
}
```

**Response (200)**

```json
{
  "message": "Annual theme updated successfully",
  "data": {
    "id": 1,
    "title": "Greater Glory and Power",
    "isActive": true
  }
}
```

---

## 6️⃣ Delete Annual Theme

**DELETE** `/theme/delete-theme?id=1`

**Response (204)**

```
No Content
```

---

## ℹ️ Important Notes

- Only **one annual theme can be active at a time**
- When `isActive = true`, all other themes are automatically deactivated
- `year` must be unique
- `imageUrl` is optional and should be a public URL

---

**Maintained by Backend Team**
