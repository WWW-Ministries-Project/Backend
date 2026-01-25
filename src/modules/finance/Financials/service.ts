import { prisma } from "../../../Models/context";

interface FinanceData {
    metaData?: {
        month: string;
        year: number;
        week: string;
        from: string;
        to: string;
        createdBy: string | null;
        createdDate: string | null;
        updatedBy: string | null;
        updatedDate: string | null;
    };
  receipts: Array<{ item: string; amount: number | null }>;
  tithe: {
    totalTithe: { percentage: number, amount: number, funds:number, label:string };
    generalTithe: { percentage: number, amount: number, funds:number, label:string};
    icareTithe: { percentage: number, amount: number, funds:number, label:string};
  };
  payments: Array<{ item: string; amount: number | null }>;
  balance: {
    ExcessOfReceiptsOverPayments: { item: string,  amount: number };
    ReserveForSavings: { item: string, amount: number};
    BalanceAmount: { item: string, amount:number };
    WeeklyRefund: { item: string, amount: number };
    OfficeMaintenanceReserve: { item: string, amount: number };
  };
  fundsAllocation: Array<{ movement: string; actual: number; portionPercent: number;  adjusted: number}>;


}


export class FinacialsService {
  /**
   * Create a new finance config
   */

  async create(data: FinanceData) {
    // try {
    //   const existingConfig = await prisma.financeData.findUnique({
    //     where: {
    //       metaData: data.metaData
    //     }
    //   });

    //   if (existingConfig) {
    //     throw new Error('Finance data for this month, year, and week already exists.');
    //   }

    //   const createdData = await prisma.financeData.create({
    //     data: {
    //       metaData: data.metaData,
    //       receipts: data.receipts,
    //       tithe: data.tithe,
    //       payments: data.payments,
    //       balance: data.balance,
    //       fundsAllocation: data.fundsAllocation
    //     }
    //   });

    //   return createdData;

    // } catch (error: any) {
    //   throw new Error(`Failed to create finance data: ${error.message}`);
    // }
  

    // return this.mapResponse(createdData);
  }

  // Fetch empty financial data
  async fetchEmptyFinancialData() {
    const receiptConfigs = await prisma.receiptConfig.findMany();
    const paymentConfigs = await prisma.paymentConfig.findMany();
    const bankAccountConfigs = await prisma.bankAccountConfig.findMany();

    const emptyData: FinanceData = {
      metaData: {
        month: '',
        year: 0,
        week: '',
        from: '',
        to: '',
        createdBy: null,
        createdDate: null,
        updatedBy: null,
        updatedDate: null,
      },
      receipts: receiptConfigs.map((config:any) => ({
        item: config.name,
        amount: 0,
      })),
      tithe: {
        totalTithe: { percentage: 0, amount: 0, funds:0, label:'' },
        generalTithe: { percentage: 0, amount: 0, funds:0, label:''},
        icareTithe: { percentage: 0, amount: 0, funds:0, label:''},
      },
      payments: paymentConfigs.map((config:any) => ({
        item: config.name,
        amount: 0,
      })),
      balance: {
        ExcessOfReceiptsOverPayments: { item: '',  amount: 0 },
        ReserveForSavings: { item: '', amount: 0},
        BalanceAmount: { item: '', amount:0 },
        WeeklyRefund: { item: '', amount: 0 },
        OfficeMaintenanceReserve: { item: '', amount: 0 },
      },
      fundsAllocation: bankAccountConfigs.map((config:any) => ({
        movement: config.name,
        portionPercent: config.percentage,
        actual: 0,
        adjusted: 0,
      })),
    };

    return emptyData;
  }

  /**
   * Fetch all finance data
   */
  async findAll() {
    const records = await prisma.financeData.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return records.map((record: any) => this.mapResponse(record));
  }

  /**
   * Fetch a single finance data record by ID
   */
  async findById(id: number) {
    const record = await prisma.financeData.findUnique({
      where: { id },
    });

    if (!record) {
      throw new Error('Finance data not found');
    }

    return this.mapResponse(record);
  }

  /**
   * Update a finance data record
   */
  async update(id: number, data: Partial<FinanceData>) {
    // Ensure record exists
    await this.findById(id);

    // const updated = await prisma.financeData.update({
    //   where: { id },
    //   data: {
    //     ...(data.metaData && { metaData: data.metaData }),
    //     ...(data.receipts && { receipts: data.receipts }),
    //     ...(data.tithe && { tithe: data.tithe }),
    //     ...(data.payments && { payments: data.payments }),
    //     ...(data.balance && { balance: data.balance }),
    //     ...(data.fundsAllocation && { fundsAllocation: data.fundsAllocation }),
    //   },
    // });

    return this.mapResponse(null);
  }

  /**
   * Delete a finance data record
   */
  async delete(id: number) {
    // Ensure record exists
    await this.findById(id);

    await prisma.financeData.delete({
      where: { id },
    });

    return {
      message: 'Finance data deleted successfully',
      id,
    };
  }
  


  /**
   * Normalize DB response
   */
  private mapResponse(financeData: any) {
    return {
      id: financeData.id,
      metaData: {
        month: financeData.metaData?.month,
        year: financeData.metaData?.year,
        week: financeData.metaData?.week,
        from: financeData.metaData?.from,
        to: financeData.metaData?.to,
        createdBy: financeData.metaData?.createdBy,
        createdDate: financeData.metaData?.createdDate,
        updatedBy: financeData.metaData?.updatedBy,
        updatedDate: financeData.metaData?.updatedDate,
        receipts: financeData.receipts,
        tithe: financeData.tithe,
        payments: financeData.payments,
        balance: financeData.balance,
        fundsAllocation: financeData.fundsAllocation
      },
    };
  }
}
