# Observed entities (from sandbox payload shapes)

Field names only, from list and detail responses seen 2026-11-05. Not exhaustive. Cin7 identifies things by GUID but takes many foreign keys **by name** on writes (location, tax rule, terms, price tier, carrier, unit, category, brand).

```mermaid
erDiagram
    CUSTOMER ||--o{ SALE : places
    SALE ||--o| QUOTE : has
    SALE ||--|| ORDER : has
    SALE ||--o{ FULFILMENT : has
    FULFILMENT ||--o| PICK : stage
    FULFILMENT ||--o| PACK : stage
    FULFILMENT ||--o| SHIP : stage
    SALE ||--o{ INVOICE : has
    INVOICE ||--o{ PAYMENT : receives
    SALE ||--o{ CREDITNOTE : has
    ORDER ||--|{ SALE_LINE : contains
    INVOICE ||--|{ SALE_LINE : repeats
    PRODUCT ||--o{ SALE_LINE : referenced_by
    PRODUCT ||--o{ AVAILABILITY : stocked_as
    LOCATION ||--o{ AVAILABILITY : holds
    SUPPLIER ||--o{ PURCHASE : receives
    PURCHASE ||--|{ PURCHASE_LINE : contains
    PRODUCT ||--o{ PURCHASE_LINE : referenced_by

    SALE {
        guid ID "SaleID in lists"
        string Status "derived rollup"
        string Type "Simple, Advanced, Service"
        string SourceChannel
        date OrderDate "SaleOrderDate in detail"
        date Updated "LastModifiedOn in detail"
        string ExternalID
        decimal COGSAmount "detail only"
    }
    FULFILMENT {
        guid TaskID
        string FulFilmentStatus
    }
    INVOICE {
        guid TaskID
        string Status
        date InvoiceDueDate
        decimal Total
        decimal Paid
    }
    SALE_LINE {
        guid ProductID
        string SKU
        decimal Quantity
        decimal BackorderQuantity
        decimal Price
    }
    PRODUCT {
        guid ID
        string SKU
        string CostingMethod
        decimal AverageCost
        decimal MinimumBeforeReorder
        decimal ReorderQuantity
        list ReorderLevels "empty in sandbox"
    }
    AVAILABILITY {
        guid ProductID "ID"
        string Location
        string Batch
        decimal OnHand
        decimal Allocated
        decimal Available
        decimal OnOrder
        decimal StockOnHand "value, not units"
    }
    PURCHASE {
        guid ID
        string Status
        string Type
        string CombinedReceivingStatus
        date RequiredBy
        date LastUpdatedDate
    }
```

Personal data sits at the top level of the sale detail (`Customer`, `Contact`, `Phone`, `Email`, billing and shipping addresses) and in invoice billing lines. Shaped outputs drop it by default.
