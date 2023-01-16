import React, { FC, useMemo } from "react";
import { Card, TableContainer, Table, TableBody } from "@mui/material";
import { useBorrowLendState } from "../../context/BorrowLend";
import UserPositionRow from "./UserPositionRow";

const UserPositions: FC = () => {
  const { accountSummary, selectedAccount, reloadUserData } =
    useBorrowLendState();
  const { isLending, isBorrowing } = useMemo(
    () => ({
      isLending: accountSummary.lendingAmount > 0,
      isBorrowing: accountSummary.borrowingAmount > 0,
    }),
    [accountSummary]
  );

  return (
    <div className="grid grid-cols-1 xl:grid-cols-2">
      {isLending && selectedAccount && (
        <Card
          elevation={0}
          className="bg-transparent w-full p-0 grid min-w-[500px]"
        >
          <div className="text-2xl my-8 text-white">Supplying</div>
          <TableContainer>
            <Table className="table-fixed">
              <TableBody>
                {accountSummary.positions
                  .filter((p) => p.isLending)
                  .map((position, index) => (
                    <UserPositionRow
                      key={index}
                      position={position}
                      marginfiAccount={selectedAccount}
                      reloadUserData={reloadUserData}
                    />
                  ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Card>
      )}
      <div>
        {isBorrowing && selectedAccount && (
          <Card
            elevation={0}
            className="bg-transparent w-full p-0 grid min-w-[500px]"
          >
            <div className="text-2xl my-8 text-white">Borrowing</div>
            <TableContainer>
              <Table className="table-fixed">
                <TableBody>
                  {accountSummary.positions
                    .filter((p) => !p.isLending)
                    .map((position, index) => (
                      <UserPositionRow
                        key={index}
                        position={position}
                        marginfiAccount={selectedAccount}
                        reloadUserData={reloadUserData}
                      />
                    ))}
                </TableBody>
              </Table>
            </TableContainer>
          </Card>
        )}
      </div>
    </div>
  );
};

export { UserPositions };
