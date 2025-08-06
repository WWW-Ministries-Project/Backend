import Router from "express";
import {ProductController} from "./productController";

const productRouter = Router();
const productController = new ProductController();
//sizes
/**
 * @swagger
 * components:
 *   schemas:
 *     SizeStock:
 *       type: object
 *       required:
 *         - size
 *         - stock
 *       properties:
 *         size:
 *           type: string
 *           description: The name of the size
 *           example: "XL"
 *         stock:
 *           type: integer
 *           minimum: 0
 *           description: Stock quantity for this size
 *           example: 50
 *
 *     ProductColourInput:
 *       type: object
 *       required:
 *         - colour
 *         - image_url
 *         - stock
 *       properties:
 *         colour:
 *           type: string
 *           description: Color name or hex code
 *           example: "Red"
 *         image_url:
 *           type: string
 *           format: uri
 *           description: URL to the product color image
 *           example: "https://example.com/images/red-shirt.jpg"
 *         stock:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SizeStock'
 *           description: Stock information for different sizes
 *
 *     CreateProductInput:
 *       type: object
 *       required:
 *         - name
 *       properties:
 *         name:
 *           type: string
 *           description: Product name
 *           example: "Cotton T-Shirt"
 *         description:
 *           type: string
 *           description: Product description
 *           example: "Comfortable cotton t-shirt available in multiple colors"
 *         published:
 *           type: boolean
 *           description: Whether the product is published
 *           default: false
 *           example: true
 *         stock_managed:
 *           type: boolean
 *           description: Whether stock is managed for this product
 *           default: false
 *           example: true
 *         product_type_id:
 *           type: integer
 *           description: ID of the product type
 *           example: 1
 *         product_category_id:
 *           type: integer
 *           description: ID of the product category
 *           example: 2
 *         price_currency:
 *           type: string
 *           description: Currency code for the price
 *           example: "USD"
 *         price_amount:
 *           type: number
 *           format: decimal
 *           minimum: 0
 *           description: Price amount
 *           example: 29.99
 *         product_colours:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductColourInput'
 *           description: Array of product colors with stock information
 *         market_id:
 *           type: integer
 *           description: ID of the market where the product will be sold
 *           example: 1
 *
 *     Product:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Product ID
 *           example: 123
 *         name:
 *           type: string
 *           description: Product name
 *           example: "Cotton T-Shirt"
 *         description:
 *           type: string
 *           description: Product description
 *           example: "Comfortable cotton t-shirt available in multiple colors"
 *         published:
 *           type: boolean
 *           description: Whether the product is published
 *           example: true
 *         stock_managed:
 *           type: boolean
 *           description: Whether stock is managed for this product
 *           example: true
 *         product_type_id:
 *           type: integer
 *           description: ID of the product type
 *           example: 1
 *         product_category_id:
 *           type: integer
 *           description: ID of the product category
 *           example: 2
 *         price_currency:
 *           type: string
 *           description: Currency code for the price
 *           example: "USD"
 *         price_amount:
 *           type: number
 *           format: decimal
 *           description: Price amount
 *           example: 29.99
 *         market_id:
 *           type: integer
 *           description: ID of the market where the product is sold
 *           example: 1
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Product creation timestamp
 *           example: "2023-12-01T10:30:00Z"
 *         updated_at:
 *           type: string
 *           format: date-time
 *           description: Product last update timestamp
 *           example: "2023-12-01T10:30:00Z"
 *
 *     ProductColour:
 *       type: object
 *       properties:
 *         id:
 *           type: integer
 *           description: Product colour ID
 *           example: 456
 *         product_id:
 *           type: integer
 *           description: Associated product ID
 *           example: 123
 *         colour:
 *           type: string
 *           description: Color name or hex code
 *           example: "Red"
 *         image_url:
 *           type: string
 *           format: uri
 *           description: URL to the product color image
 *           example: "https://example.com/images/red-shirt.jpg"
 *         created_at:
 *           type: string
 *           format: date-time
 *           description: Product colour creation timestamp
 *           example: "2023-12-01T10:30:00Z"
 *
 *     CreateProductResponse:
 *       type: object
 *       properties:
 *         product:
 *           $ref: '#/components/schemas/Product'
 *         product_colours:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductColour'
 *           description: Array of created product colours
 *
 *     ErrorResponse:
 *       type: object
 *       properties:
 *         error:
 *           type: string
 *           description: Error message
 *           example: "Market with given id does not exist"
 *         code:
 *           type: string
 *           description: Error code
 *           example: "INVALID_MARKET"
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Error timestamp
 *           example: "2023-12-01T10:30:00Z"
 */

/**
 * @swagger
 * /product/create-product:
 *   post:
 *     summary: Create a new product
 *     description: Creates a new product with optional color variants and stock information. Validates that the specified market exists before creating the product.
 *     tags:
 *       - Products
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CreateProductInput'
 *           examples:
 *             basic_product:
 *               summary: Basic product without colors
 *               value:
 *                 name: "Basic Cotton T-Shirt"
 *                 description: "Simple cotton t-shirt"
 *                 published: true
 *                 price_currency: "USD"
 *                 price_amount: 19.99
 *                 market_id: 1
 *             product_with_colors:
 *               summary: Product with color variants and stock
 *               value:
 *                 name: "Premium Cotton T-Shirt"
 *                 description: "High-quality cotton t-shirt in multiple colors"
 *                 published: true
 *                 stock_managed: true
 *                 product_type_id: 1
 *                 product_category_id: 5
 *                 price_currency: "USD"
 *                 price_amount: 29.99
 *                 market_id: 1
 *                 product_colours:
 *                   - colour: "Red"
 *                     image_url: "https://example.com/images/red-shirt.jpg"
 *                     stock:
 *                       - size: "L"
 *                         stock: 25
 *                       - size: "XL"
 *                         stock: 30
 *                   - colour: "Blue"
 *                     image_url: "https://example.com/images/blue-shirt.jpg"
 *                     stock:
 *                       - size: "S"
 *                         stock: 20
 *                       - size: "M"
 *                         stock: 35
 *     responses:
 *       201:
 *         description: Product created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CreateProductResponse'
 *             examples:
 *               success_with_colors:
 *                 summary: Successful creation with colors
 *                 value:
 *                   product:
 *                     id: 123
 *                     name: "Premium Cotton T-Shirt"
 *                     description: "High-quality cotton t-shirt in multiple colors"
 *                     published: true
 *                     stock_managed: true
 *                     product_type_id: 1
 *                     product_category_id: 5
 *                     price_currency: "USD"
 *                     price_amount: 29.99
 *                     market_id: 1
 *                     created_at: "2023-12-01T10:30:00Z"
 *                     updated_at: "2023-12-01T10:30:00Z"
 *                   product_colours:
 *                     - id: 456
 *                       product_id: 123
 *                       colour: "Red"
 *                       image_url: "https://example.com/images/red-shirt.jpg"
 *                       created_at: "2023-12-01T10:30:00Z"
 *                     - id: 457
 *                       product_id: 123
 *                       colour: "Blue"
 *                       image_url: "https://example.com/images/blue-shirt.jpg"
 *                       created_at: "2023-12-01T10:30:00Z"
 *               success_without_colors:
 *                 summary: Successful creation without colors
 *                 value:
 *                   product:
 *                     id: 124
 *                     name: "Basic Cotton T-Shirt"
 *                     description: "Simple cotton t-shirt"
 *                     published: true
 *                     stock_managed: false
 *                     price_currency: "USD"
 *                     price_amount: 19.99
 *                     market_id: 1
 *                     created_at: "2023-12-01T10:30:00Z"
 *                     updated_at: "2023-12-01T10:30:00Z"
 *                   product_colours: null
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missing_name:
 *                 summary: Missing required name field
 *                 value:
 *                   error: "Product name is required"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T10:30:00Z"
 *               invalid_market:
 *                 summary: Invalid market ID
 *                 value:
 *                   error: "Market with given id does not exist"
 *                   code: "INVALID_MARKET"
 *                   timestamp: "2023-12-01T10:30:00Z"
 *       422:
 *         description: Unprocessable entity - business logic error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalid_price:
 *                 summary: Invalid price amount
 *                 value:
 *                   error: "Price amount must be greater than 0"
 *                   code: "INVALID_PRICE"
 *                   timestamp: "2023-12-01T10:30:00Z"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               database_error:
 *                 summary: Database connection error
 *                 value:
 *                   error: "Database connection failed"
 *                   code: "DATABASE_ERROR"
 *                   timestamp: "2023-12-01T10:30:00Z"
 */
productRouter.post("/create-size", productController.createSize);
productRouter.put("/update-size", productController.updateSize);
productRouter.get("/list-sizes", productController.listSizes);
//products
productRouter.post("/create-product", productController.createProduct);
/**
 * @swagger
 * components:
 *   schemas:
 *     UpdateProductInput:
 *       allOf:
 *         - $ref: '#/components/schemas/CreateProductInput'
 *         - type: object
 *           required:
 *             - id
 *           properties:
 *             id:
 *               type: integer
 *               description: The ID of the product to update
 *               example: 123
 */
/**
 * @swagger
 * /product/update-product:
 *   put:
 *     summary: Update an existing product
 *     description: Updates an existing product with new information. All fields from the original product creation are available for update. If product_colours are provided, they will replace existing color variants.
 *     tags:
 *       - Products
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/UpdateProductInput'
 *           examples:
 *             update_basic_info:
 *               summary: Update basic product information
 *               value:
 *                 id: 123
 *                 name: "Updated Premium Cotton T-Shirt"
 *                 description: "Updated description for high-quality cotton t-shirt"
 *                 published: false
 *                 price_amount: 34.99
 *             update_with_new_colors:
 *               summary: Update product with new color variants
 *               value:
 *                 id: 123
 *                 name: "Premium Cotton T-Shirt - New Colors"
 *                 description: "High-quality cotton t-shirt now available in new colors"
 *                 published: true
 *                 stock_managed: true
 *                 price_currency: "USD"
 *                 price_amount: 32.99
 *                 market_id: 1
 *                 product_colours:
 *                   - colour: "Green"
 *                     image_url: "https://example.com/images/green-shirt.jpg"
 *                     stock:
 *                       - size: "S"
 *                         stock: 15
 *                       - size: "M"
 *                         stock: 20
 *                   - colour: "Black"
 *                     image_url: "https://example.com/images/black-shirt.jpg"
 *                     stock:
 *                       - size: "L"
 *                         stock: 30
 *                       - size_id: "XL"
 *                         stock: 25
 *             partial_update:
 *               summary: Partial update (only specific fields)
 *               value:
 *                 id: 123
 *                 price_amount: 27.99
 *                 published: true
 *     responses:
 *       200:
 *         description: Product updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CreateProductResponse'
 *             examples:
 *               successful_update:
 *                 summary: Successful product update
 *                 value:
 *                   product:
 *                     id: 123
 *                     name: "Updated Premium Cotton T-Shirt"
 *                     description: "Updated description for high-quality cotton t-shirt"
 *                     published: false
 *                     stock_managed: true
 *                     product_type_id: 1
 *                     product_category_id: 5
 *                     price_currency: "USD"
 *                     price_amount: 34.99
 *                     market_id: 1
 *                     created_at: "2023-12-01T10:30:00Z"
 *                     updated_at: "2023-12-01T15:45:00Z"
 *                   product_colours:
 *                     - id: 458
 *                       product_id: 123
 *                       colour: "Green"
 *                       image_url: "https://example.com/images/green-shirt.jpg"
 *                       created_at: "2023-12-01T15:45:00Z"
 *                     - id: 459
 *                       product_id: 123
 *                       colour: "Black"
 *                       image_url: "https://example.com/images/black-shirt.jpg"
 *                       created_at: "2023-12-01T15:45:00Z"
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missing_id:
 *                 summary: Missing required product ID
 *                 value:
 *                   error: "Product ID is required for update"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T15:45:00Z"
 *               invalid_market:
 *                 summary: Invalid market ID
 *                 value:
 *                   error: "Market with given id does not exist"
 *                   code: "INVALID_MARKET"
 *                   timestamp: "2023-12-01T15:45:00Z"
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               product_not_found:
 *                 summary: Product with given ID does not exist
 *                 value:
 *                   error: "Product with ID 123 not found"
 *                   code: "PRODUCT_NOT_FOUND"
 *                   timestamp: "2023-12-01T15:45:00Z"
 *       422:
 *         description: Unprocessable entity - business logic error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               invalid_price:
 *                 summary: Invalid price amount
 *                 value:
 *                   error: "Price amount must be greater than 0"
 *                   code: "INVALID_PRICE"
 *                   timestamp: "2023-12-01T15:45:00Z"
 *               duplicate_colors:
 *                 summary: Duplicate color variants
 *                 value:
 *                   error: "Duplicate color variants are not allowed"
 *                   code: "DUPLICATE_COLORS"
 *                   timestamp: "2023-12-01T15:45:00Z"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               database_error:
 *                 summary: Database update error
 *                 value:
 *                   error: "Failed to update product in database"
 *                   code: "DATABASE_ERROR"
 *                   timestamp: "2023-12-01T15:45:00Z"
 */
productRouter.put("/update-product", productController.updateProduct);
/**
 * @swagger
 * components:
 *   schemas:
 *     ProductColourStockInput:
 *       type: object
 *       required:
 *         - id
 *         - product_id
 *         - colour
 *         - image_url
 *         - stock
 *       properties:
 *         id:
 *           type: integer
 *           description: The ID of the product colour to update
 *           example: 456
 *         product_id:
 *           type: integer
 *           description: The ID of the parent product
 *           example: 123
 *         colour:
 *           type: string
 *           description: Color name or hex code
 *           example: "Red"
 *         image_url:
 *           type: string
 *           format: uri
 *           description: URL to the product color image
 *           example: "https://example.com/images/red-shirt.jpg"
 *         stock:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/SizeStock'
 *           description: Updated stock information for different sizes
 *
 *     UpdateProductColourStockResponse:
 *       type: object
 *       properties:
 *         updated_colours:
 *           type: array
 *           items:
 *             $ref: '#/components/schemas/ProductColour'
 *           description: Array of updated product colours with stock information
 *         total_updated:
 *           type: integer
 *           description: Total number of product colours updated
 *           example: 2
 */
/**
 * @swagger
 * /product/update-product-colour-stock:
 *   put:
 *     summary: Update product colour stock information
 *     description: Updates stock information for one or more product colour variants. This endpoint allows bulk updates of stock levels across different sizes and colours for existing products.
 *     tags:
 *       - Products
 *       - Stock Management
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             items:
 *               $ref: '#/components/schemas/ProductColourStockInput'
 *             minItems: 1
 *             description: Array of product colour stock updates
 *           examples:
 *             single_colour_update:
 *               summary: Update stock for a single colour
 *               value:
 *                 - id: 456
 *                   product_id: 123
 *                   colour: "Red"
 *                   image_url: "https://example.com/images/red-shirt.jpg"
 *                   stock:
 *                     - size: "S"
 *                       stock: 45
 *                     - size: "M"
 *                       stock: 30
 *                     - size: "L"
 *                       stock: 25
 *             multiple_colours_update:
 *               summary: Update stock for multiple colours
 *               value:
 *                 - id: 456
 *                   product_id: 123
 *                   colour: "Red"
 *                   image_url: "https://example.com/images/red-shirt.jpg"
 *                   stock:
 *                     - size: "XL"
 *                       stock: 35
 *                     - size: "2XL"
 *                       stock: 40
 *                 - id: 457
 *                   product_id: 123
 *                   colour: "Blue"
 *                   image_url: "https://example.com/images/blue-shirt.jpg"
 *                   stock:
 *                     - size: "3XL"
 *                       stock: 20
 *                     - size: "4XL"
 *                       stock: 15
 *             stock_replenishment:
 *               summary: Stock replenishment update
 *               value:
 *                 - id: 458
 *                   product_id: 124
 *                   colour: "Green"
 *                   image_url: "https://example.com/images/green-shirt.jpg"
 *                   stock:
 *                     - size: "M"
 *                       stock: 100
 *                     - size: "L"
 *                       stock: 150
 *                     - size: "XL"
 *                       stock: 75
 *     responses:
 *       200:
 *         description: Product colour stock updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/UpdateProductColourStockResponse'
 *             examples:
 *               successful_update:
 *                 summary: Successful stock update
 *                 value:
 *                   updated_colours:
 *                     - id: 456
 *                       product_id: 123
 *                       colour: "Red"
 *                       image_url: "https://example.com/images/red-shirt.jpg"
 *                       created_at: "2023-12-01T10:30:00Z"
 *                       updated_at: "2023-12-01T16:20:00Z"
 *                     - id: 457
 *                       product_id: 123
 *                       colour: "Blue"
 *                       image_url: "https://example.com/images/blue-shirt.jpg"
 *                       created_at: "2023-12-01T10:30:00Z"
 *                       updated_at: "2023-12-01T16:20:00Z"
 *                   total_updated: 2
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               empty_array:
 *                 summary: Empty input array
 *                 value:
 *                   error: "At least one product colour must be provided for update"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *               missing_required_fields:
 *                 summary: Missing required fields
 *                 value:
 *                   error: "Product colour ID and product ID are required"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *               invalid_stock:
 *                 summary: Invalid stock values
 *                 value:
 *                   error: "Stock values must be non-negative integers"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *       404:
 *         description: Resource not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               colour_not_found:
 *                 summary: Product colour not found
 *                 value:
 *                   error: "Product colour with ID 456 not found"
 *                   code: "COLOUR_NOT_FOUND"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *               product_not_found:
 *                 summary: Parent product not found
 *                 value:
 *                   error: "Product with ID 123 not found"
 *                   code: "PRODUCT_NOT_FOUND"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *               size_not_found:
 *                 summary: Size not found
 *                 value:
 *                   error: "Size with ID 5 not found"
 *                   code: "SIZE_NOT_FOUND"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *       422:
 *         description: Unprocessable entity - business logic error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               mismatched_product:
 *                 summary: Product colour doesn't belong to specified product
 *                 value:
 *                   error: "Product colour 456 does not belong to product 123"
 *                   code: "PRODUCT_MISMATCH"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *               duplicate_size_entries:
 *                 summary: Duplicate size entries in stock array
 *                 value:
 *                   error: "Duplicate size entries found in stock array"
 *                   code: "DUPLICATE_SIZES"
 *                   timestamp: "2023-12-01T16:20:00Z"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               database_error:
 *                 summary: Database update error
 *                 value:
 *                   error: "Failed to update stock information in database"
 *                   code: "DATABASE_ERROR"
 *                   timestamp: "2023-12-01T16:20:00Z"
 */
productRouter.put("/update-product-colour-stock", productController.updateProductColourStock);
/**
 * @swagger
 * components:
 *   schemas:
 *     ProductActionResponse:
 *       type: object
 *       properties:
 *         success:
 *           type: boolean
 *           description: Whether the operation was successful
 *           example: true
 *         message:
 *           type: string
 *           description: Success or error message
 *           example: "Product deleted successfully"
 *         product_id:
 *           type: integer
 *           description: ID of the affected product
 *           example: 123
 *         timestamp:
 *           type: string
 *           format: date-time
 *           description: Operation timestamp
 *           example: "2023-12-01T16:45:00Z"
 */
/**
 * @swagger
 * /product/delete-product:
 *   delete:
 *     summary: Delete a product
 *     description: Soft deletes a product by marking it as deleted. The product and its associated data (colours, stock) will be hidden from regular queries but preserved in the database for potential restoration.
 *     tags:
 *       - Products
 *       - Product Management
 *     parameters:
 *       - in: query
 *         name: product_id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: The ID of the product to delete
 *         example: 123
 *     responses:
 *       200:
 *         description: Product deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductActionResponse'
 *             examples:
 *               successful_deletion:
 *                 summary: Successful product deletion
 *                 value:
 *                   success: true
 *                   message: "Product deleted successfully"
 *                   product_id: 123
 *                   timestamp: "2023-12-01T16:45:00Z"
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missing_product_id:
 *                 summary: Missing product_id parameter
 *                 value:
 *                   error: "Product ID is required"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T16:45:00Z"
 *               invalid_product_id:
 *                 summary: Invalid product_id format
 *                 value:
 *                   error: "Product ID must be a positive integer"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T16:45:00Z"
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               product_not_found:
 *                 summary: Product with given ID does not exist
 *                 value:
 *                   error: "Product with ID 123 not found"
 *                   code: "PRODUCT_NOT_FOUND"
 *                   timestamp: "2023-12-01T16:45:00Z"
 *       409:
 *         description: Conflict - product already deleted
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               already_deleted:
 *                 summary: Product is already deleted
 *                 value:
 *                   error: "Product with ID 123 is already deleted"
 *                   code: "PRODUCT_ALREADY_DELETED"
 *                   timestamp: "2023-12-01T16:45:00Z"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               database_error:
 *                 summary: Database deletion error
 *                 value:
 *                   error: "Failed to delete product from database"
 *                   code: "DATABASE_ERROR"
 *                   timestamp: "2023-12-01T16:45:00Z"
 */
/**
 * @swagger
 * /product/restore-product:
 *   put:
 *     summary: Restore a deleted product
 *     description: Restores a previously soft-deleted product, making it visible and available again. The product and its associated data (colours, stock) will be restored to active status.
 *     tags:
 *       - Products
 *       - Product Management
 *     parameters:
 *       - in: query
 *         name: product_id
 *         required: true
 *         schema:
 *           type: integer
 *           minimum: 1
 *         description: The ID of the product to restore
 *         example: 123
 *     responses:
 *       200:
 *         description: Product restored successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ProductActionResponse'
 *             examples:
 *               successful_restoration:
 *                 summary: Successful product restoration
 *                 value:
 *                   success: true
 *                   message: "Product restored successfully"
 *                   product_id: 123
 *                   timestamp: "2023-12-01T17:00:00Z"
 *       400:
 *         description: Bad request - validation error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               missing_product_id:
 *                 summary: Missing product_id parameter
 *                 value:
 *                   error: "Product ID is required"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T17:00:00Z"
 *               invalid_product_id:
 *                 summary: Invalid product_id format
 *                 value:
 *                   error: "Product ID must be a positive integer"
 *                   code: "VALIDATION_ERROR"
 *                   timestamp: "2023-12-01T17:00:00Z"
 *       404:
 *         description: Product not found
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               product_not_found:
 *                 summary: Product with given ID does not exist
 *                 value:
 *                   error: "Product with ID 123 not found"
 *                   code: "PRODUCT_NOT_FOUND"
 *                   timestamp: "2023-12-01T17:00:00Z"
 *               product_not_deleted:
 *                 summary: Product is not in deleted state
 *                 value:
 *                   error: "Product with ID 123 is not deleted and cannot be restored"
 *                   code: "PRODUCT_NOT_DELETED"
 *                   timestamp: "2023-12-01T17:00:00Z"
 *       409:
 *         description: Conflict - product is already active
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               already_active:
 *                 summary: Product is already active
 *                 value:
 *                   error: "Product with ID 123 is already active"
 *                   code: "PRODUCT_ALREADY_ACTIVE"
 *                   timestamp: "2023-12-01T17:00:00Z"
 *       500:
 *         description: Internal server error
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ErrorResponse'
 *             examples:
 *               database_error:
 *                 summary: Database restoration error
 *                 value:
 *                   error: "Failed to restore product in database"
 *                   code: "DATABASE_ERROR"
 *                   timestamp: "2023-12-01T17:00:00Z"
 */
productRouter.delete("/delete-product", productController.deleteProduct);
productRouter.put("/restore-product", productController.restoreProduct);
productRouter.get("/list-products", productController.listProducts);
productRouter.get("/list-products-by-market", productController.listProductsByMarketId);
productRouter.get("/get-product-by-id", productController.getProductById);
//product type
productRouter.post("/create-product-type", productController.createProductType);
productRouter.put("/update-product-type", productController.updateProductType);
productRouter.delete("/delete-product-type", productController.deleteProductType);
productRouter.put("/restore-product-type", productController.restoreProductType);
productRouter.get("/list-product-type", productController.listProductTypes);
//product category
productRouter.post("/create-product-category", productController.createProductCategory);
productRouter.put("/update-product-category", productController.updateProductCategory);
productRouter.delete("/delete-product-category", productController.deleteProductCategory);
productRouter.put("/restore-product-category", productController.restoreProductCategory);
productRouter.get("/list-product-category", productController.listProductCategories);

export default productRouter;