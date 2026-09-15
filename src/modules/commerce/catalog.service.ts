import {
  Bundle,
  CommissionType,
  DiscountType,
  Product,
  ProductCategory,
  ProductStatus,
} from "@prisma/client";
import { prisma } from "../../lib/prisma";
import { badRequest, notFound } from "../../lib/http";

/**
 * COMMERCE module — admin catalog CRUD: ProductCategory, Product,
 * ProductImage, Discount, Bundle/BundleItem, InventoryLocation/InventoryStock.
 * This is the admin surface described in the spec ("add/remove products,
 * change prices, manage inventory, upload product images, create discounts,
 * create bundles, ... disable products").
 */

// ----------------------------------------------------------------------------
// ProductCategory
// ----------------------------------------------------------------------------

export interface CreateProductCategoryInput {
  name: string;
  slug: string;
  description?: string;
  ageRestricted?: boolean;
  regulatedCategory?: boolean;
}

export async function createProductCategory(input: CreateProductCategoryInput) {
  return prisma.productCategory.create({
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      ageRestricted: input.ageRestricted ?? false,
      regulatedCategory: input.regulatedCategory ?? false,
    },
  });
}

export async function listProductCategories() {
  return prisma.productCategory.findMany({ orderBy: { name: "asc" } });
}

export interface UpdateProductCategoryInput {
  name?: string;
  slug?: string;
  description?: string;
  ageRestricted?: boolean;
  regulatedCategory?: boolean;
  active?: boolean;
}

export async function updateProductCategory(
  categoryId: string,
  input: UpdateProductCategoryInput
) {
  const category = await prisma.productCategory.findUnique({ where: { id: categoryId } });
  if (!category) notFound(`ProductCategory ${categoryId} not found`);

  return prisma.productCategory.update({
    where: { id: categoryId },
    data: {
      name: input.name,
      slug: input.slug,
      description: input.description,
      ageRestricted: input.ageRestricted,
      regulatedCategory: input.regulatedCategory,
      active: input.active,
    },
  });
}

// ----------------------------------------------------------------------------
// Product
// ----------------------------------------------------------------------------

/**
 * A product may only be marked resaleEligible=true when it is safe for the
 * driver-to-rider resale flow: never age-restricted, never in a regulated
 * category (alcohol/tobacco/nicotine/cannabis/prescription drugs/weapons/
 * other age-restricted or regulated merchandise). MVP has no path to enable
 * these — this check is unconditional.
 */
function assertResaleEligibilityAllowed(
  ageRestricted: boolean,
  category: Pick<ProductCategory, "regulatedCategory">
) {
  if (ageRestricted) {
    badRequest("Cannot mark a product resaleEligible=true while ageRestricted=true");
  }
  if (category.regulatedCategory) {
    badRequest("Cannot mark a product resaleEligible=true for a regulated category");
  }
}

export interface CreateProductInput {
  sku: string;
  name: string;
  description?: string;
  categoryId: string;
  priceCents: number;
  platformCostCents: number;
  currency?: string;
  resaleEligible?: boolean;
  requiresSealedPackaging?: boolean;
  ageRestricted?: boolean;
  expiresAt?: Date;
  createdBy?: string;
}

export async function createProduct(input: CreateProductInput): Promise<Product> {
  const category = await prisma.productCategory.findUnique({ where: { id: input.categoryId } });
  if (!category) notFound(`ProductCategory ${input.categoryId} not found`);

  const resaleEligible = input.resaleEligible ?? false;
  const ageRestricted = input.ageRestricted ?? false;
  if (resaleEligible) {
    assertResaleEligibilityAllowed(ageRestricted, category!);
  }

  return prisma.product.create({
    data: {
      sku: input.sku,
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      priceCents: input.priceCents,
      platformCostCents: input.platformCostCents,
      currency: input.currency ?? "USD",
      resaleEligible,
      requiresSealedPackaging: input.requiresSealedPackaging ?? true,
      ageRestricted,
      expiresAt: input.expiresAt,
      createdBy: input.createdBy,
    },
  });
}

export interface ListProductsFilters {
  status?: ProductStatus;
  categoryId?: string;
  resaleEligible?: boolean;
}

export async function listProducts(filters: ListProductsFilters = {}) {
  return prisma.product.findMany({
    where: {
      status: filters.status,
      categoryId: filters.categoryId,
      resaleEligible: filters.resaleEligible,
    },
    include: { category: true, images: { orderBy: { sortOrder: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
}

export async function getProduct(productId: string) {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: true,
      images: { orderBy: { sortOrder: "asc" } },
      inventoryStock: { include: { location: true } },
    },
  });
  if (!product) notFound(`Product ${productId} not found`);
  return product;
}

export interface UpdateProductInput {
  name?: string;
  description?: string;
  categoryId?: string;
  priceCents?: number;
  platformCostCents?: number;
  status?: ProductStatus;
  resaleEligible?: boolean;
  requiresSealedPackaging?: boolean;
  ageRestricted?: boolean;
  expiresAt?: Date | null;
}

/**
 * Covers price changes, disabling a product (status: DISABLED), marking it
 * RECALLED, toggling resaleEligible/requiresSealedPackaging, etc. — the
 * spec's "change prices ... disable products" admin actions all funnel
 * through here.
 */
export async function updateProduct(
  productId: string,
  input: UpdateProductInput
): Promise<Product> {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true },
  });
  if (!product) notFound(`Product ${productId} not found`);

  let category = product!.category;
  if (input.categoryId && input.categoryId !== product!.categoryId) {
    const found = await prisma.productCategory.findUnique({ where: { id: input.categoryId } });
    if (!found) notFound(`ProductCategory ${input.categoryId} not found`);
    category = found!;
  }

  const nextResaleEligible = input.resaleEligible ?? product!.resaleEligible;
  const nextAgeRestricted = input.ageRestricted ?? product!.ageRestricted;
  if (nextResaleEligible) {
    assertResaleEligibilityAllowed(nextAgeRestricted, category);
  }

  return prisma.product.update({
    where: { id: productId },
    data: {
      name: input.name,
      description: input.description,
      categoryId: input.categoryId,
      priceCents: input.priceCents,
      platformCostCents: input.platformCostCents,
      status: input.status,
      resaleEligible: input.resaleEligible,
      requiresSealedPackaging: input.requiresSealedPackaging,
      ageRestricted: input.ageRestricted,
      expiresAt: input.expiresAt,
    },
  });
}

// ----------------------------------------------------------------------------
// ProductImage
// ----------------------------------------------------------------------------

export interface AddProductImageInput {
  url: string;
  altText?: string;
  sortOrder?: number;
}

export async function addProductImage(productId: string, input: AddProductImageInput) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound(`Product ${productId} not found`);

  return prisma.productImage.create({
    data: {
      productId,
      url: input.url,
      altText: input.altText,
      sortOrder: input.sortOrder ?? 0,
    },
  });
}

export async function removeProductImage(imageId: string) {
  const image = await prisma.productImage.findUnique({ where: { id: imageId } });
  if (!image) notFound(`ProductImage ${imageId} not found`);
  await prisma.productImage.delete({ where: { id: imageId } });
  return { id: imageId, deleted: true };
}

// ----------------------------------------------------------------------------
// Discount
// ----------------------------------------------------------------------------

export interface CreateDiscountInput {
  code?: string;
  name: string;
  type: DiscountType;
  value: number;
  productId?: string;
  categoryId?: string;
  startsAt: Date;
  endsAt?: Date;
  usageLimit?: number;
}

/**
 * Discounts scope to a product or a category (or neither, applying storewide
 * — an automatic promo). `value` is a rate (0-1) for PERCENTAGE or whole
 * cents for FIXED_AMOUNT, matching the schema's Decimal comment. Only
 * automatic discounts (code: null) are auto-applied at checkout in this MVP
 * — see orders.service.ts; explicit discount codes are stored/validated here
 * but redemption-by-code is left for a future checkout enhancement.
 */
export async function createDiscount(input: CreateDiscountInput) {
  if (input.productId) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) notFound(`Product ${input.productId} not found`);
  }
  if (input.categoryId) {
    const category = await prisma.productCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) notFound(`ProductCategory ${input.categoryId} not found`);
  }
  // Bound `value` the same way ev-incentives bounds its own rate fields —
  // an out-of-range PERCENTAGE (e.g. 1.5 meant as "150%") would otherwise
  // let computeAutomaticDiscountCents discount a line for more than its
  // total, driving the order total negative.
  if (input.type === DiscountType.PERCENTAGE && (input.value < 0 || input.value > 1)) {
    badRequest("A PERCENTAGE discount's value must be between 0 and 1 (e.g. 0.15 for 15%)");
  }
  if (input.type === DiscountType.FIXED_AMOUNT && input.value < 0) {
    badRequest("A FIXED_AMOUNT discount's value (cents) must be non-negative");
  }

  return prisma.discount.create({
    data: {
      code: input.code ?? null,
      name: input.name,
      type: input.type,
      value: input.value,
      productId: input.productId,
      categoryId: input.categoryId,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      usageLimit: input.usageLimit,
    },
  });
}

export interface ListDiscountsFilters {
  productId?: string;
  categoryId?: string;
  active?: boolean;
}

export async function listDiscounts(filters: ListDiscountsFilters = {}) {
  return prisma.discount.findMany({
    where: {
      productId: filters.productId,
      categoryId: filters.categoryId,
      active: filters.active,
    },
    orderBy: { startsAt: "desc" },
  });
}

// ----------------------------------------------------------------------------
// Bundle / BundleItem
// ----------------------------------------------------------------------------

export interface CreateBundleInput {
  name: string;
  description?: string;
  priceCents: number;
  items: Array<{ productId: string; quantity: number }>;
}

export async function createBundle(input: CreateBundleInput): Promise<Bundle> {
  if (!input.items || input.items.length === 0) {
    badRequest("A bundle needs at least one component product");
  }

  const productIds = input.items.map((i) => i.productId);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } } });
  if (products.length !== new Set(productIds).size) {
    badRequest("One or more bundle component productIds do not exist");
  }

  return prisma.bundle.create({
    data: {
      name: input.name,
      description: input.description,
      priceCents: input.priceCents,
      items: {
        create: input.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
      },
    },
    include: { items: { include: { product: true } } },
  });
}

export async function listBundles() {
  return prisma.bundle.findMany({
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });
}

// ----------------------------------------------------------------------------
// InventoryLocation / InventoryStock
// ----------------------------------------------------------------------------

export async function createInventoryLocation(name: string) {
  return prisma.inventoryLocation.create({ data: { name } });
}

export async function listInventoryLocations() {
  return prisma.inventoryLocation.findMany({ orderBy: { name: "asc" } });
}

export interface AdjustInventoryStockInput {
  quantityOnHand?: number;
  quantityReserved?: number;
  reorderThreshold?: number;
}

export async function adjustInventoryStock(
  productId: string,
  locationId: string,
  input: AdjustInventoryStockInput
) {
  const product = await prisma.product.findUnique({ where: { id: productId } });
  if (!product) notFound(`Product ${productId} not found`);
  const location = await prisma.inventoryLocation.findUnique({ where: { id: locationId } });
  if (!location) notFound(`InventoryLocation ${locationId} not found`);

  return prisma.inventoryStock.upsert({
    where: { productId_locationId: { productId, locationId } },
    create: {
      productId,
      locationId,
      quantityOnHand: input.quantityOnHand ?? 0,
      quantityReserved: input.quantityReserved ?? 0,
      reorderThreshold: input.reorderThreshold ?? 0,
    },
    update: {
      quantityOnHand: input.quantityOnHand,
      quantityReserved: input.quantityReserved,
      reorderThreshold: input.reorderThreshold,
    },
  });
}

export async function getInventoryStock(productId: string) {
  return prisma.inventoryStock.findMany({
    where: { productId },
    include: { location: true },
  });
}

// ----------------------------------------------------------------------------
// CommissionRule — admin-configurable driver commission for the
// driver-to-rider resale flow (driver-sale.service.ts). Falls back from a
// product-specific rule to a category-level rule to a hardcoded platform
// default (20% of gross margin) when nothing matches — see
// driver-sale.service.ts's DEFAULT_COMMISSION_RATE.
// ----------------------------------------------------------------------------

export interface CreateCommissionRuleInput {
  productId?: string;
  categoryId?: string;
  type: CommissionType;
  value: number;
  effectiveStart?: Date;
  effectiveEnd?: Date;
}

function validateCommissionRuleInput(input: Partial<CreateCommissionRuleInput>) {
  if (!input.productId && !input.categoryId) {
    badRequest("A CommissionRule must scope to either a productId or a categoryId");
  }
  if (input.type === CommissionType.PERCENTAGE && input.value != null && (input.value < 0 || input.value > 1)) {
    // Bounded to [0,1] because driver-sale.service.ts computes this rate
    // against gross margin (sale price - platform cost); a value above 1
    // would let driverCommissionCents exceed the margin, silently costing
    // the platform money on every matching sale.
    badRequest("A PERCENTAGE CommissionRule's value must be between 0 and 1 (e.g. 0.2 for 20% of gross margin)");
  }
  if (input.type === CommissionType.FLAT && input.value != null && input.value < 0) {
    badRequest("A FLAT CommissionRule's value (cents per unit) must be non-negative");
  }
  if (input.effectiveEnd && input.effectiveStart && input.effectiveEnd < input.effectiveStart) {
    badRequest("effectiveEnd must not be before effectiveStart");
  }
}

export async function createCommissionRule(input: CreateCommissionRuleInput) {
  validateCommissionRuleInput(input);
  if (input.productId) {
    const product = await prisma.product.findUnique({ where: { id: input.productId } });
    if (!product) notFound(`Product ${input.productId} not found`);
  }
  if (input.categoryId) {
    const category = await prisma.productCategory.findUnique({ where: { id: input.categoryId } });
    if (!category) notFound(`ProductCategory ${input.categoryId} not found`);
  }

  return prisma.commissionRule.create({
    data: {
      productId: input.productId ?? null,
      categoryId: input.categoryId ?? null,
      type: input.type,
      value: input.value,
      effectiveStart: input.effectiveStart ?? new Date(),
      effectiveEnd: input.effectiveEnd ?? null,
    },
  });
}

export interface ListCommissionRulesFilters {
  productId?: string;
  categoryId?: string;
  active?: boolean;
}

export async function listCommissionRules(filters: ListCommissionRulesFilters = {}) {
  return prisma.commissionRule.findMany({
    where: {
      productId: filters.productId,
      categoryId: filters.categoryId,
      active: filters.active,
    },
    orderBy: { effectiveStart: "desc" },
  });
}

export async function updateCommissionRule(
  id: string,
  input: Partial<Pick<CreateCommissionRuleInput, "type" | "value" | "effectiveStart" | "effectiveEnd">> & {
    active?: boolean;
  }
) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) notFound(`CommissionRule ${id} not found`);

  validateCommissionRuleInput({
    type: input.type ?? existing!.type,
    value: input.value ?? existing!.value.toNumber(),
    effectiveStart: input.effectiveStart ?? existing!.effectiveStart,
    effectiveEnd: input.effectiveEnd !== undefined ? input.effectiveEnd : existing!.effectiveEnd ?? undefined,
  });

  return prisma.commissionRule.update({
    where: { id },
    data: {
      ...(input.type !== undefined ? { type: input.type } : {}),
      ...(input.value !== undefined ? { value: input.value } : {}),
      ...(input.effectiveStart !== undefined ? { effectiveStart: input.effectiveStart } : {}),
      ...(input.effectiveEnd !== undefined ? { effectiveEnd: input.effectiveEnd } : {}),
      ...(input.active !== undefined ? { active: input.active } : {}),
    },
  });
}

export async function deactivateCommissionRule(id: string) {
  const existing = await prisma.commissionRule.findUnique({ where: { id } });
  if (!existing) notFound(`CommissionRule ${id} not found`);
  return prisma.commissionRule.update({ where: { id }, data: { active: false } });
}
