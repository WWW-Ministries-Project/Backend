declare module "../../libs/zkteco-js" {
  export class ZktecoJs {
    constructor(ip: string, port: number, timeout: number, inport?: number);
    createSocket(cbErr?: () => void, cbClose?: () => void): Promise<boolean>;
    disconnect(): Promise<void>;
    connect(): Promise<void>;
    setUser(
      uid: number,
      userid: string,
      name: string,
      password: string,
      role?: number,
      cardno?: number,
    ): Promise<any>;
    getUsers(): Promise<any[]>;
    getAttendances(cb?: Function): Promise<any>;
    getRealTimeLogs(cb?: Function): Promise<any>;
  }
}
